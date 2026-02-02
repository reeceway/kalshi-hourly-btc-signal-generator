import { CONFIG } from "../config.js";

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch candlestick data from Coinbase public API
 * Granularity options: 60, 300, 900, 3600, 21600, 86400 (in seconds)
 * Returns max 300 candles per request
 *
 * Response format: [timestamp, price_low, price_high, price_open, price_close, volume]
 */
export async function fetchKlines({ interval, limit }) {
  // Convert interval to granularity in seconds
  const granularityMap = {
    '1m': 60,
    '3m': 180,  // Note: Coinbase doesn't support 3m, will use 60s
    '5m': 300,
    '15m': 900,
    '1h': 3600,
    '1d': 86400
  };

  let granularity = granularityMap[interval] || 60;

  // Coinbase only supports specific granularities
  const validGranularities = [60, 300, 900, 3600, 21600, 86400];
  if (!validGranularities.includes(granularity)) {
    granularity = 60; // Default to 1 minute
  }

  // Calculate time range (Coinbase max 300 candles)
  const actualLimit = Math.min(limit, 300);
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - (granularity * actualLimit);

  const url = new URL(`/products/${CONFIG.coinbase.productId}/candles`, CONFIG.coinbase.baseUrl);
  url.searchParams.set('start', startTime.toString());
  url.searchParams.set('end', endTime.toString());
  url.searchParams.set('granularity', granularity.toString());

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Coinbase candles error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();

  // Coinbase returns [timestamp, low, high, open, close, volume]
  // We need to convert to match Binance format
  return data.map((candle) => ({
    openTime: Number(candle[0]) * 1000, // Convert to milliseconds
    open: toNumber(candle[3]),
    high: toNumber(candle[2]),
    low: toNumber(candle[1]),
    close: toNumber(candle[4]),
    volume: toNumber(candle[5]),
    closeTime: (Number(candle[0]) + granularity) * 1000
  })).reverse(); // Coinbase returns newest first, we want oldest first
}

/**
 * Fetch current BTC price from Coinbase
 */
export async function fetchLastPrice() {
  const url = new URL(`/products/${CONFIG.coinbase.productId}/ticker`, CONFIG.coinbase.baseUrl);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Coinbase ticker error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return toNumber(data.price);
}

/**
 * Fetch 24h stats for BTC
 */
export async function fetch24HStats() {
  const url = new URL(`/products/${CONFIG.coinbase.productId}/stats`, CONFIG.coinbase.baseUrl);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Coinbase stats error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return {
    open: toNumber(data.open),
    high: toNumber(data.high),
    low: toNumber(data.low),
    last: toNumber(data.last),
    volume: toNumber(data.volume)
  };
}
