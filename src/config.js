import 'dotenv/config';

export const CONFIG = {
  // Coinbase configuration (replaces Binance)
  coinbase: {
    productId: process.env.COINBASE_PRODUCT_ID || "BTC-USD",
    baseUrl: process.env.COINBASE_BASE_URL || "https://api.exchange.coinbase.com",
    wsUrl: process.env.COINBASE_WS_URL || "wss://ws-feed.exchange.coinbase.com"
  },

  // Kalshi configuration (replaces Polymarket)
  kalshi: {
    baseUrl: process.env.KALSHI_BASE_URL || "https://api.elections.kalshi.com",
    apiKey: process.env.KALSHI_API_KEY || "",
    privateKey: process.env.KALSHI_PRIVATE_KEY || "", // RSA private key for signing
    ticker: process.env.KALSHI_TICKER || "KXBTCD", // Hourly Bitcoin market
    autoTrade: (process.env.KALSHI_AUTO_TRADE || "false").toLowerCase() === "true",
    maxPositionSize: Number(process.env.KALSHI_MAX_POSITION || "10"), // Max contracts per trade
    minEdgePercent: Number(process.env.KALSHI_MIN_EDGE || "5"), // Minimum edge to enter trade (%)
  },

  // Trading parameters (changed from 15m to 1h)
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || "2000"), // Poll every 2 seconds
  candleWindowMinutes: 60, // Hourly market instead of 15m

  // Technical indicator settings
  vwapSlopeLookbackMinutes: 10,
  rsiPeriod: 14,
  rsiMaPeriod: 14,

  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
};
