import { CONFIG } from "../config.js";
import crypto from "node:crypto";

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * Generate authentication headers for Kalshi API
 * Requires API key and private key for RSA-PSS signature
 */
function generateKalshiAuthHeaders(method, path, body = null) {
  const timestamp = Date.now().toString();

  // Create signature payload (timestamp + method + path ONLY - no body!)
  const messageToSign = timestamp + method + path;

  if (!CONFIG.kalshi.privateKey) {
    throw new Error("Kalshi private key not configured");
  }

  try {
    // Sign with RSA-PSS (Kalshi requirement)
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(messageToSign);
    const signature = sign.sign({
      key: CONFIG.kalshi.privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
    }, 'base64');

    return {
      'KALSHI-ACCESS-KEY': CONFIG.kalshi.apiKey,
      'KALSHI-ACCESS-SIGNATURE': signature,
      'KALSHI-ACCESS-TIMESTAMP': timestamp,
      'Content-Type': 'application/json'
    };
  } catch (err) {
    console.error('Failed to generate Kalshi auth headers:', err.message);
    throw err;
  }
}

/**
 * Fetch market data for a specific ticker (e.g., KXBTC)
 */
export async function fetchMarketByTicker(ticker) {
  const path = `/trade-api/v2/markets/${ticker}`;
  const url = new URL(path, CONFIG.kalshi.baseUrl);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Kalshi market error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.market || null;
}

/**
 * Get the current active KXBTCD hourly market closest to current BTC price
 * KXBTCD markets have multiple strikes - we pick the one nearest to current price
 */
export async function fetchCurrentKxbtcMarket(currentBtcPrice = null) {
  // Use series_ticker instead of ticker to get all KXBTCD markets
  const path = `/trade-api/v2/markets?series_ticker=${CONFIG.kalshi.ticker}&status=open&limit=100`;
  const url = new URL(path, CONFIG.kalshi.baseUrl);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Kalshi markets error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const markets = Array.isArray(data.markets) ? data.markets : [];

  if (markets.length === 0) return null;

  // Find markets closing in the next 2 hours
  const now = Date.now();
  const twoHoursLater = now + (2 * 60 * 60 * 1000);
  const soonMarkets = markets.filter(m => {
    const closeTime = new Date(m.close_time).getTime();
    return closeTime > now && closeTime <= twoHoursLater;
  });

  if (soonMarkets.length === 0) return null;

  // If no current price provided, just return the one closing soonest
  if (!currentBtcPrice) {
    return soonMarkets.sort((a, b) => {
      return new Date(a.close_time).getTime() - new Date(b.close_time).getTime();
    })[0];
  }

  // Parse strike prices and find the one closest to current BTC price
  const marketsWithStrikes = soonMarkets.map(m => {
    const ticker = m.ticker || '';
    // Parse ticker like "KXBTCD-26FEB0201-T75000" or "KXBTCD-26FEB0201-B74500"
    const match = ticker.match(/-([TB])(\d+(?:\.\d+)?)/);
    const strikePrice = match ? parseFloat(match[2]) : 0;
    const distance = Math.abs(strikePrice - currentBtcPrice);
    const closeTime = new Date(m.close_time).getTime();
    return { ...m, strikePrice, distance, closeTime };
  });

  // Sort by close time first (nearest), then by distance to current price
  marketsWithStrikes.sort((a, b) => {
    if (a.closeTime !== b.closeTime) {
      return a.closeTime - b.closeTime;
    }
    return a.distance - b.distance;
  });

  return marketsWithStrikes[0] || null;
}

/**
 * Fetch orderbook for a specific market ticker
 */
export async function fetchOrderBook({ ticker }) {
  const path = `/trade-api/v2/markets/${ticker}/orderbook`;
  const url = new URL(path, CONFIG.kalshi.baseUrl);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Kalshi orderbook error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.orderbook || { yes: [], no: [] };
}

/**
 * Summarize orderbook to get best bid/ask and liquidity
 */
export function summarizeOrderBook(book, depthLevels = 5) {
  const yesBids = Array.isArray(book?.yes) ? book.yes : [];
  const noBids = Array.isArray(book?.no) ? book.no : [];

  // For Kalshi, yes bids are the "up" side, no bids are the "down" side
  const bestYesBid = yesBids.length > 0 ? toNumber(yesBids[0][0]) : null; // [price, size]
  const bestNoBid = noBids.length > 0 ? toNumber(noBids[0][0]) : null;

  const bestYesAsk = yesBids.length > 1 ? toNumber(yesBids[1][0]) : null;
  const bestNoAsk = noBids.length > 1 ? toNumber(noBids[1][0]) : null;

  const yesSpread = bestYesBid !== null && bestYesAsk !== null ? bestYesAsk - bestYesBid : null;
  const noSpread = bestNoBid !== null && bestNoAsk !== null ? bestNoAsk - bestNoBid : null;

  const yesLiquidity = yesBids.slice(0, depthLevels).reduce((acc, x) => acc + (toNumber(x[1]) ?? 0), 0);
  const noLiquidity = noBids.slice(0, depthLevels).reduce((acc, x) => acc + (toNumber(x[1]) ?? 0), 0);

  return {
    yes: {
      bestBid: bestYesBid,
      bestAsk: bestYesAsk,
      spread: yesSpread,
      bidLiquidity: yesLiquidity,
      askLiquidity: yesLiquidity
    },
    no: {
      bestBid: bestNoBid,
      bestAsk: bestNoAsk,
      spread: noSpread,
      bidLiquidity: noLiquidity,
      askLiquidity: noLiquidity
    }
  };
}

/**
 * Place an order on Kalshi (for automated trading)
 * Side: "yes" or "no"
 * Action: "buy" or "sell"
 */
export async function placeOrder({ ticker, side, action, count, price, type = "limit" }) {
  const path = `/trade-api/v2/portfolio/orders`;
  const url = new URL(path, CONFIG.kalshi.baseUrl);

  const orderPayload = {
    ticker,
    side,
    action,
    count,
    type,
    ...(type === "limit" && { yes_price: price })
  };

  const body = JSON.stringify(orderPayload);
  const headers = generateKalshiAuthHeaders('POST', path, body);

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body
  });

  if (!res.ok) {
    throw new Error(`Kalshi order error: ${res.status} ${await res.text()}`);
  }

  return await res.json();
}

/**
 * Get portfolio positions (for tracking open positions)
 */
export async function fetchPortfolio() {
  const path = `/trade-api/v2/portfolio/positions`;
  const url = new URL(path, CONFIG.kalshi.baseUrl);

  const headers = generateKalshiAuthHeaders('GET', path);

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Kalshi portfolio error: ${res.status} ${await res.text()}`);
  }

  return await res.json();
}

/**
 * Fetch current market snapshot with prices and orderbook
 * Pass current BTC price to select the optimal strike
 */
export async function fetchKalshiSnapshot(currentBtcPrice = null) {
  try {
    const market = await fetchCurrentKxbtcMarket(currentBtcPrice);

    if (!market) {
      return { ok: false, reason: "market_not_found" };
    }

    const ticker = market.ticker;
    const orderbook = await fetchOrderBook({ ticker });
    const summary = summarizeOrderBook(orderbook);

    // Kalshi prices are in cents (0-100)
    const yesPrice = market.yes_bid ? toNumber(market.yes_bid) / 100 : null;
    const noPrice = market.no_bid ? toNumber(market.no_bid) / 100 : null;

    return {
      ok: true,
      market,
      ticker,
      strikePrice: market.strikePrice || null,
      prices: {
        up: yesPrice,  // YES = UP (will be >= strike)
        down: noPrice  // NO = DOWN (will be < strike)
      },
      orderbook: {
        up: summary.yes,
        down: summary.no
      }
    };
  } catch (err) {
    return { ok: false, reason: "fetch_error", error: err.message };
  }
}
