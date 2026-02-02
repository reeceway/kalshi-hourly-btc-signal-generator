import { CONFIG } from "../config.js";
import WebSocket from "ws";

/**
 * Start Coinbase WebSocket stream for BTC-USD ticker
 * Provides real-time price updates
 */
export function startCoinbaseTickerStream({ productId = CONFIG.coinbase.productId }) {
  let ws = null;
  let lastTick = null;
  let reconnectTimer = null;
  let isConnected = false;

  function connect() {
    try {
      ws = new WebSocket(CONFIG.coinbase.wsUrl);

      ws.on('open', () => {
        console.log('[Coinbase WS] Connected');
        isConnected = true;

        // Subscribe to ticker channel
        const subscribeMsg = {
          type: 'subscribe',
          product_ids: [productId],
          channels: ['ticker']
        };

        ws.send(JSON.stringify(subscribeMsg));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          // Ticker messages have type "ticker"
          if (msg.type === 'ticker' && msg.product_id === productId) {
            const price = Number(msg.price);
            if (Number.isFinite(price)) {
              lastTick = {
                price,
                time: msg.time ? new Date(msg.time).getTime() : Date.now(),
                bestBid: msg.best_bid ? Number(msg.best_bid) : null,
                bestAsk: msg.best_ask ? Number(msg.best_ask) : null,
                volume24h: msg.volume_24h ? Number(msg.volume_24h) : null
              };
            }
          }
        } catch (err) {
          console.error('[Coinbase WS] Message parse error:', err.message);
        }
      });

      ws.on('error', (err) => {
        console.error('[Coinbase WS] Error:', err.message);
      });

      ws.on('close', () => {
        console.log('[Coinbase WS] Disconnected');
        isConnected = false;
        scheduleReconnect();
      });

    } catch (err) {
      console.error('[Coinbase WS] Connection error:', err.message);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!isConnected) {
        console.log('[Coinbase WS] Reconnecting...');
        connect();
      }
    }, 5000);
  }

  function cleanup() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  // Initial connection
  connect();

  return {
    getLast: () => lastTick,
    isConnected: () => isConnected,
    cleanup
  };
}
