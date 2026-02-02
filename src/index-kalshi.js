import { CONFIG } from "./config.js";
import { fetchKlines, fetchLastPrice } from "./data/coinbase.js";
import { startCoinbaseTickerStream } from "./data/coinbaseWs.js";
import { fetchKalshiSnapshot, placeOrder, fetchPortfolio } from "./data/kalshi.js";
import { computeSessionVwap, computeVwapSeries } from "./indicators/vwap.js";
import fs from "node:fs";
import { computeRsi, sma, slopeLast } from "./indicators/rsi.js";
import { computeMacd } from "./indicators/macd.js";
import { computeHeikenAshi, countConsecutive } from "./indicators/heikenAshi.js";
import { detectRegime } from "./engines/regime.js";
import { scoreDirection, applyTimeAwareness } from "./engines/probability.js";
import { computeEdge, decide } from "./engines/edge-kalshi.js";
import { appendCsvRow, formatNumber, formatPct, getCandleWindowTiming, sleep } from "./utils.js";
import readline from "node:readline";
import { applyGlobalProxyFromEnv } from "./net/proxy.js";

applyGlobalProxyFromEnv();

const ANSI = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  lightRed: "\x1b[91m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
  dim: "\x1b[2m"
};

function screenWidth() {
  const w = Number(process.stdout?.columns);
  return Number.isFinite(w) && w >= 40 ? w : 80;
}

function sepLine(ch = "─") {
  const w = screenWidth();
  return `${ANSI.white}${ch.repeat(w)}${ANSI.reset}`;
}

function renderScreen(text) {
  try {
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
  } catch {
    // ignore
  }
  process.stdout.write(text);
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "");
}

function padLabel(label, width) {
  const visible = stripAnsi(label).length;
  if (visible >= width) return label;
  return label + " ".repeat(width - visible);
}

function centerText(text, width) {
  const visible = stripAnsi(text).length;
  if (visible >= width) return text;
  const left = Math.floor((width - visible) / 2);
  const right = width - visible - left;
  return " ".repeat(left) + text + " ".repeat(right);
}

const LABEL_W = 18;
function kv(label, value) {
  const l = padLabel(String(label), LABEL_W);
  return `${l}${value}`;
}

function colorPriceLine({ label, price, prevPrice, decimals = 0, prefix = "" }) {
  if (price === null || price === undefined) {
    return `${label}: ${ANSI.gray}-${ANSI.reset}`;
  }

  const p = Number(price);
  const prev = prevPrice === null || prevPrice === undefined ? null : Number(prevPrice);

  let color = ANSI.reset;
  let arrow = "";
  if (prev !== null && Number.isFinite(prev) && Number.isFinite(p) && p !== prev) {
    if (p > prev) {
      color = ANSI.green;
      arrow = " ↑";
    } else {
      color = ANSI.red;
      arrow = " ↓";
    }
  }

  const formatted = `${prefix}${formatNumber(p, decimals)}`;
  return `${label}: ${color}${formatted}${arrow}${ANSI.reset}`;
}

function formatSignedDelta(delta, base) {
  if (delta === null || base === null || base === 0) return `${ANSI.gray}-${ANSI.reset}`;
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  const pct = (Math.abs(delta) / Math.abs(base)) * 100;
  return `${sign}$${Math.abs(delta).toFixed(2)}, ${sign}${pct.toFixed(2)}%`;
}

function colorByNarrative(text, narrative) {
  if (narrative === "LONG") return `${ANSI.green}${text}${ANSI.reset}`;
  if (narrative === "SHORT") return `${ANSI.red}${text}${ANSI.reset}`;
  return `${ANSI.gray}${text}${ANSI.reset}`;
}

function formatNarrativeValue(label, value, narrative) {
  return `${label}: ${colorByNarrative(value, narrative)}`;
}

function narrativeFromSign(x) {
  if (x === null || x === undefined || !Number.isFinite(Number(x)) || Number(x) === 0) return "NEUTRAL";
  return Number(x) > 0 ? "LONG" : "SHORT";
}

function narrativeFromSlope(slope) {
  if (slope === null || slope === undefined || !Number.isFinite(Number(slope)) || Number(slope) === 0) return "NEUTRAL";
  return Number(slope) > 0 ? "LONG" : "SHORT";
}

function formatProbPct(p, digits = 0) {
  if (p === null || p === undefined || !Number.isFinite(Number(p))) return "-";
  return `${(Number(p) * 100).toFixed(digits)}%`;
}

function fmtTimeLeft(mins) {
  const totalSeconds = Math.max(0, Math.floor(mins * 60));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtEtTime(now = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(now);
  } catch {
    return "-";
  }
}

function countVwapCrosses(closes, vwapSeries, lookback) {
  if (closes.length < lookback || vwapSeries.length < lookback) return null;
  let crosses = 0;
  for (let i = closes.length - lookback + 1; i < closes.length; i += 1) {
    const prev = closes[i - 1] - vwapSeries[i - 1];
    const cur = closes[i] - vwapSeries[i];
    if (prev === 0) continue;
    if ((prev > 0 && cur < 0) || (prev < 0 && cur > 0)) crosses += 1;
  }
  return crosses;
}

// Track last trade to avoid duplicate entries
let lastTradeTimestamp = 0;
let currentPosition = null; // { side: "yes" | "no", count: number, entryPrice: number }

async function executeTradeIfNeeded(recommendation, kalshi, spotPrice) {
  if (!CONFIG.kalshi.autoTrade) {
    return null; // Auto-trading disabled
  }

  if (recommendation.action !== "ENTER") {
    return null; // No trade signal
  }

  const side = recommendation.side === "UP" ? "yes" : "no";
  const now = Date.now();

  try {
    // Place order (convert price to cents as integer)
    const priceDecimal = side === "yes" ? kalshi.prices.up : kalshi.prices.down;
    const priceCents = Math.round(priceDecimal * 100);

    const orderResult = await placeOrder({
      ticker: kalshi.ticker,
      side,
      action: "buy",
      count: CONFIG.kalshi.maxPositionSize,
      price: priceCents,
      type: "limit"
    });

    lastTradeTimestamp = now;
    currentPosition = {
      side,
      count: CONFIG.kalshi.maxPositionSize,
      entryPrice: side === "yes" ? kalshi.prices.up : kalshi.prices.down,
      entryTime: now,
      entrySpotPrice: spotPrice
    };

    return { success: true, order: orderResult, position: currentPosition };
  } catch (err) {
    console.error('[Trade Error]', err.message);
    return { success: false, error: err.message };
  }
}

async function main() {
  const coinbaseStream = startCoinbaseTickerStream({ productId: CONFIG.coinbase.productId });

  let prevSpotPrice = null;
  let prevCurrentPrice = null;

  const header = [
    "timestamp",
    "entry_minute",
    "time_left_min",
    "regime",
    "signal",
    "model_up",
    "model_down",
    "mkt_up",
    "mkt_down",
    "edge_up",
    "edge_down",
    "recommendation",
    "trade_executed"
  ];

  console.log(`${ANSI.green}═══════════════════════════════════════════${ANSI.reset}`);
  console.log(`${ANSI.green}  Kalshi KXBTC Hourly Trading Assistant   ${ANSI.reset}`);
  console.log(`${ANSI.green}═══════════════════════════════════════════${ANSI.reset}\n`);
  console.log(`Auto-trading: ${CONFIG.kalshi.autoTrade ? `${ANSI.green}ENABLED${ANSI.reset}` : `${ANSI.yellow}DISABLED${ANSI.reset}`}`);
  console.log(`Max position: ${CONFIG.kalshi.maxPositionSize} contracts`);
  console.log(`Phase thresholds: EARLY 5% | MID 10% | LATE 20%\n`);

  await sleep(2000);

  while (true) {
    const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);

    const wsTick = coinbaseStream.getLast();
    const wsPrice = wsTick?.price ?? null;

    try {
      // Fetch price first to select optimal Kalshi strike
      const lastPrice = await fetchLastPrice();

      const [klines1m, klines5m, kalshi] = await Promise.all([
        fetchKlines({ interval: "1m", limit: 240 }),
        fetchKlines({ interval: "5m", limit: 200 }),
        fetchKalshiSnapshot(lastPrice)
      ]);

      const candles = klines1m;
      const closes = candles.map((c) => c.close);

      const vwap = computeSessionVwap(candles);
      const vwapSeries = computeVwapSeries(candles);
      const vwapNow = vwapSeries[vwapSeries.length - 1];

      const lookback = CONFIG.vwapSlopeLookbackMinutes;
      const vwapSlope = vwapSeries.length >= lookback ? (vwapNow - vwapSeries[vwapSeries.length - lookback]) / lookback : null;
      const vwapDist = vwapNow ? (lastPrice - vwapNow) / vwapNow : null;

      const rsiNow = computeRsi(closes, CONFIG.rsiPeriod);
      const rsiSeries = [];
      for (let i = 0; i < closes.length; i += 1) {
        const sub = closes.slice(0, i + 1);
        const r = computeRsi(sub, CONFIG.rsiPeriod);
        if (r !== null) rsiSeries.push(r);
      }
      const rsiMa = sma(rsiSeries, CONFIG.rsiMaPeriod);
      const rsiSlope = slopeLast(rsiSeries, 3);

      const macd = computeMacd(closes, CONFIG.macdFast, CONFIG.macdSlow, CONFIG.macdSignal);
      const ha = computeHeikenAshi(candles);
      const consec = countConsecutive(ha);

      const vwapCrossCount = countVwapCrosses(closes, vwapSeries, 20);
      const volumeRecent = candles.slice(-20).reduce((a, c) => a + c.volume, 0);
      const volumeAvg = candles.slice(-120).reduce((a, c) => a + c.volume, 0) / 6;

      const failedVwapReclaim = vwapNow !== null && vwapSeries.length >= 3
        ? closes[closes.length - 1] < vwapNow && closes[closes.length - 2] > vwapSeries[vwapSeries.length - 2]
        : false;

      const regimeInfo = detectRegime({
        price: lastPrice,
        vwap: vwapNow,
        vwapSlope,
        vwapCrossCount,
        volumeRecent,
        volumeAvg
      });

      const scored = scoreDirection({
        price: lastPrice,
        vwap: vwapNow,
        vwapSlope,
        rsi: rsiNow,
        rsiSlope,
        macd,
        heikenColor: consec.color,
        heikenCount: consec.count,
        failedVwapReclaim
      });

      const timeLeftMin = timing.remainingMinutes;
      const timeAware = applyTimeAwareness(scored.rawUp, timeLeftMin, CONFIG.candleWindowMinutes);

      const marketUp = kalshi.ok ? kalshi.prices.up : null;
      const marketDown = kalshi.ok ? kalshi.prices.down : null;
      const edge = computeEdge({ modelUp: timeAware.adjustedUp, modelDown: timeAware.adjustedDown, marketYes: marketUp, marketNo: marketDown });

      const rec = decide({ remainingMinutes: timeLeftMin, edgeUp: edge.edgeUp, edgeDown: edge.edgeDown, modelUp: timeAware.adjustedUp, modelDown: timeAware.adjustedDown });

      // Execute trade if needed
      const tradeResult = await executeTradeIfNeeded(rec, kalshi, lastPrice);

      const vwapSlopeLabel = vwapSlope === null ? "-" : vwapSlope > 0 ? "UP" : vwapSlope < 0 ? "DOWN" : "FLAT";
      const macdLabel = macd === null
        ? "-"
        : macd.hist < 0
          ? (macd.histDelta !== null && macd.histDelta < 0 ? "bearish (expanding)" : "bearish")
          : (macd.histDelta !== null && macd.histDelta > 0 ? "bullish (expanding)" : "bullish");

      const lastCandle = klines1m.length ? klines1m[klines1m.length - 1] : null;
      const lastClose = lastCandle?.close ?? null;
      const close1mAgo = klines1m.length >= 2 ? klines1m[klines1m.length - 2]?.close ?? null : null;
      const close3mAgo = klines1m.length >= 4 ? klines1m[klines1m.length - 4]?.close ?? null : null;
      const delta1m = lastClose !== null && close1mAgo !== null ? lastClose - close1mAgo : null;
      const delta3m = lastClose !== null && close3mAgo !== null ? lastClose - close3mAgo : null;

      const haNarrative = (consec.color ?? "").toLowerCase() === "green" ? "LONG" : (consec.color ?? "").toLowerCase() === "red" ? "SHORT" : "NEUTRAL";
      const rsiNarrative = narrativeFromSlope(rsiSlope);
      const macdNarrative = narrativeFromSign(macd?.hist ?? null);
      const vwapNarrative = narrativeFromSign(vwapDist);

      const pLong = timeAware?.adjustedUp ?? null;
      const pShort = timeAware?.adjustedDown ?? null;
      const predictValue = `${ANSI.green}LONG${ANSI.reset} ${ANSI.green}${formatProbPct(pLong, 0)}${ANSI.reset} / ${ANSI.red}SHORT${ANSI.reset} ${ANSI.red}${formatProbPct(pShort, 0)}${ANSI.reset}`;

      const marketUpStr = `${(marketUp * 100).toFixed(1) ?? "-"}${marketUp === null || marketUp === undefined ? "" : "¢"}`;
      const marketDownStr = `${(marketDown * 100).toFixed(1) ?? "-"}${marketDown === null || marketDown === undefined ? "" : "¢"}`;
      const kalshiHeaderValue = `${ANSI.green}↑ YES${ANSI.reset} ${marketUpStr}  |  ${ANSI.red}↓ NO${ANSI.reset} ${marketDownStr}`;

      const heikenValue = `${consec.color ?? "-"} x${consec.count}`;
      const heikenLine = formatNarrativeValue("Heiken Ashi", heikenValue, haNarrative);

      const rsiArrow = rsiSlope !== null && rsiSlope < 0 ? "↓" : rsiSlope !== null && rsiSlope > 0 ? "↑" : "-";
      const rsiValue = `${formatNumber(rsiNow, 1)} ${rsiArrow}`;
      const rsiLine = formatNarrativeValue("RSI", rsiValue, rsiNarrative);

      const macdLine = formatNarrativeValue("MACD", macdLabel, macdNarrative);

      const delta1Narrative = narrativeFromSign(delta1m);
      const delta3Narrative = narrativeFromSign(delta3m);
      const deltaValue = `${colorByNarrative(formatSignedDelta(delta1m, lastClose), delta1Narrative)} | ${colorByNarrative(formatSignedDelta(delta3m, lastClose), delta3Narrative)}`;

      const vwapValue = `${formatNumber(vwapNow, 0)} (${formatPct(vwapDist, 2)}) | slope: ${vwapSlopeLabel}`;
      const vwapLine = formatNarrativeValue("VWAP", vwapValue, vwapNarrative);

      const signal = rec.action === "ENTER" ? (rec.side === "UP" ? "BUY YES" : "BUY NO") : "NO TRADE";

      const spotPrice = wsPrice ?? lastPrice;
      const currentPrice = lastPrice;

      const spotPriceLine = colorPriceLine({ label: "BTC (Coinbase)", price: spotPrice, prevPrice: prevSpotPrice, decimals: 2, prefix: "$" });
      const currentPriceLine = colorPriceLine({ label: "CURRENT PRICE", price: currentPrice, prevPrice: prevCurrentPrice, decimals: 2, prefix: "$" });

      const marketTitle = kalshi.ok ? `KXBTC: ${kalshi.ticker}` : "KXBTC: -";
      const timeColor = timeLeftMin >= 40 && timeLeftMin <= 60
        ? ANSI.green
        : timeLeftMin >= 20 && timeLeftMin < 40
          ? ANSI.yellow
          : timeLeftMin >= 0 && timeLeftMin < 20
            ? ANSI.red
            : ANSI.reset;

      const tradeStatusLine = tradeResult?.success
        ? `${ANSI.green}✓ Trade executed: ${tradeResult.position.side.toUpperCase()} x${tradeResult.position.count}${ANSI.reset}`
        : currentPosition
          ? `Position: ${currentPosition.side.toUpperCase()} x${currentPosition.count} @ ${currentPosition.entryPrice.toFixed(2)}¢`
          : "No active position";

      const lines = [
        `${ANSI.white}${centerText(marketTitle, screenWidth())}${ANSI.reset}`,
        kv("Time left:", `${timeColor}${fmtTimeLeft(timeLeftMin)}${ANSI.reset}`),
        "",
        sepLine(),
        "",
        kv("TA Predict:", predictValue),
        kv("Heiken Ashi:", heikenLine.split(": ")[1] ?? heikenLine),
        kv("RSI:", rsiLine.split(": ")[1] ?? rsiLine),
        kv("MACD:", macdLine.split(": ")[1] ?? macdLine),
        kv("Delta 1/3:", deltaValue),
        kv("VWAP:", vwapLine.split(": ")[1] ?? vwapLine),
        "",
        sepLine(),
        "",
        kv("KALSHI:", kalshiHeaderValue),
        kv("Signal:", signal),
        kv("Edge UP:", edge.edgeUp !== null ? `${edge.edgeUp.toFixed(2)}%` : "-"),
        kv("Edge DOWN:", edge.edgeDown !== null ? `${edge.edgeDown.toFixed(2)}%` : "-"),
        "",
        sepLine(),
        "",
        kv("", currentPriceLine.split(": ")[1] ?? currentPriceLine),
        "",
        sepLine(),
        "",
        kv("Status:", tradeStatusLine),
        kv("ET Time:", `${ANSI.white}${fmtEtTime(new Date())}${ANSI.reset}`),
        "",
        sepLine(),
        centerText(`${ANSI.dim}${ANSI.gray}Kalshi Hourly Bot - Modified for KXBTC${ANSI.reset}`, screenWidth())
      ];

      renderScreen(lines.join("\n") + "\n");

      prevSpotPrice = spotPrice ?? prevSpotPrice;
      prevCurrentPrice = currentPrice ?? prevCurrentPrice;

      appendCsvRow("./logs/kalshi-signals.csv", header, [
        new Date().toISOString(),
        timing.elapsedMinutes.toFixed(3),
        timeLeftMin.toFixed(3),
        regimeInfo.regime,
        signal,
        timeAware.adjustedUp,
        timeAware.adjustedDown,
        marketUp,
        marketDown,
        edge.edgeUp,
        edge.edgeDown,
        rec.action === "ENTER" ? `${rec.side}:${rec.phase}:${rec.strength}` : "NO_TRADE",
        tradeResult?.success ? "YES" : "NO"
      ]);

      // Write JSON signal for moltbot integration
      const jsonSignal = {
        timestamp: new Date().toISOString(),
        ticker: kalshi.ticker || null,
        btc_price: lastPrice,
        signal: rec.action === "ENTER" ? (rec.side === "UP" ? "BUY_YES" : "BUY_NO") : "NO_TRADE",
        signal_side: rec.side || null,
        phase: rec.phase || null,
        strength: rec.strength || null,
        edge_up: edge.edgeUp,
        edge_down: edge.edgeDown,
        best_edge: rec.action === "ENTER" ? (rec.side === "UP" ? edge.edgeUp : edge.edgeDown) : null,
        model_up: timeAware.adjustedUp,
        model_down: timeAware.adjustedDown,
        market_yes: marketUp,
        market_no: marketDown,
        time_remaining_min: timeLeftMin,
        regime: regimeInfo.regime,
        rsi: rsiNow,
        macd_signal: macd?.hist < 0 ? "bearish" : "bullish",
        heiken_ashi: {
          color: consec.color,
          count: consec.count
        }
      };

      fs.writeFileSync("./logs/current-signal.json", JSON.stringify(jsonSignal, null, 2));

    } catch (err) {
      console.log("────────────────────────────────");
      console.log(`Error: ${err?.message ?? String(err)}`);
      console.log("────────────────────────────────");
    }

    await sleep(CONFIG.pollIntervalMs);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
