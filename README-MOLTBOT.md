# Kalshi Hourly BTC Signal Generator

**Signal generator for Kalshi KXBTCD (hourly Bitcoin) markets** - Provides real-time trading signals in JSON format for integration with moltbot or other trading systems.

Adapted from the original [Polymarket 15-minute BTC assistant](https://github.com/FrondEnt/PolymarketBTC15mAssistant) with:
- Scaled timing from 15-minute to 60-minute markets
- Kalshi API integration (KXBTCD hourly markets)
- Coinbase price data (replacing Binance)
- JSON signal output for external bot integration
- Same proven technical analysis (VWAP, RSI, MACD, Heiken Ashi)

---

## 🎯 What This Does

**This is a SIGNAL GENERATOR, not a trading bot.** It:
- ✅ Analyzes Bitcoin price action every 2 seconds
- ✅ Generates BUY/NO TRADE signals based on technical indicators
- ✅ Outputs signals to JSON file for your trading bot to consume
- ❌ Does NOT execute trades automatically
- ❌ Does NOT manage positions or exits

**Your trading bot (moltbot)** handles:
- Trade execution
- Position management
- Exit logic
- Risk management

---

## 🚀 Quick Start

### Prerequisites
- Node.js v20+
- Kalshi API credentials (API key + RSA private key)
- macOS (for launchd service) or Linux

### 1. Clone & Install
```bash
git clone https://github.com/reeceway/kalshi-hourly-btc-signal-generator.git
cd kalshi-hourly-btc-signal-generator
npm install
```

### 2. Configure Environment
Create `.env` file:
```bash
# Kalshi API Credentials
KALSHI_API_KEY=your_api_key_here
KALSHI_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
your_private_key_here
-----END RSA PRIVATE KEY-----"

# Signal Generator Mode (do NOT enable auto-trade)
KALSHI_AUTO_TRADE=false

# Coinbase Public API (no auth needed)
COINBASE_PRODUCT_ID=BTC-USD
COINBASE_BASE_URL=https://api.exchange.coinbase.com
COINBASE_WS_URL=wss://ws-feed.exchange.coinbase.com

# Polling interval (2 seconds recommended)
POLL_INTERVAL_MS=2000
```

### 3. Test Run
```bash
npm run kalshi
```

You should see live signal generation in the terminal.

### 4. Run as Background Service (macOS)
```bash
# Copy launchd plist (update paths if needed)
cp ~/PolymarketBTC15mAssistant/Library/LaunchAgents/com.kalshi.trading-bot.plist ~/Library/LaunchAgents/

# Load and start
launchctl load ~/Library/LaunchAgents/com.kalshi.trading-bot.plist

# View logs
tail -f ~/PolymarketBTC15mAssistant/logs/bot-output.log
```

---

## 📊 Signal Output Format

### JSON Signal File
**Location:** `./logs/current-signal.json`
**Updated:** Every 2 seconds

```json
{
  "timestamp": "2026-02-02T06:47:35.057Z",
  "ticker": "KXBTCD-26FEB0202-T76249.99",
  "btc_price": 76365.76,
  "signal": "BUY_YES",           // "BUY_YES", "BUY_NO", or "NO_TRADE"
  "signal_side": "UP",            // "UP" or "DOWN" when signal active
  "phase": "EARLY",               // "EARLY", "MID", or "LATE"
  "strength": "STRONG",           // "STRONG", "GOOD", or "OPTIONAL"
  "edge_up": 0.182,               // Edge for YES position
  "edge_down": -0.152,            // Edge for NO position
  "best_edge": 0.182,             // Best available edge
  "model_up": 0.682,              // Model's UP probability (0-1)
  "model_down": 0.318,            // Model's DOWN probability (0-1)
  "market_yes": 0.50,             // Current YES market price (0-1)
  "market_no": 0.46,              // Current NO market price (0-1)
  "time_remaining_min": 42.5,     // Minutes until market closes
  "regime": "TREND_UP",           // Market regime
  "rsi": 68.12,                   // RSI indicator
  "macd_signal": "bullish",       // MACD direction
  "heiken_ashi": {
    "color": "green",
    "count": 8
  }
}
```

### CSV Log (History)
**Location:** `./logs/kalshi-signals.csv`
Contains full signal history with all indicators for backtesting.

---

## 🤖 Moltbot Integration

### Signal Polling (Recommended)
```python
import json
import time

SIGNAL_FILE = "/path/to/kalshi-hourly-btc-signal-generator/logs/current-signal.json"

while True:
    with open(SIGNAL_FILE, 'r') as f:
        signal = json.load(f)

    if signal['signal'] in ['BUY_YES', 'BUY_NO']:
        # Apply your own filters
        if signal['strength'] == 'STRONG' and signal['best_edge'] > 0.15:
            execute_trade(
                ticker=signal['ticker'],
                side='yes' if signal['signal'] == 'BUY_YES' else 'no',
                edge=signal['best_edge']
            )

    time.sleep(2)
```

### Signal Filtering Examples
```python
# Only trade EARLY phase with STRONG signals
if signal['phase'] == 'EARLY' and signal['strength'] == 'STRONG':
    trade()

# Only trade edges > 15%
if signal['best_edge'] > 0.15:
    trade()

# Require model confidence > 65%
if signal['signal'] == 'BUY_YES' and signal['model_up'] > 0.65:
    trade()

# Skip trades near expiration
if signal['time_remaining_min'] > 10:
    trade()
```

---

## 🧠 Trading Logic

### Phase-Based Thresholds (Scaled from 15m → 60m)
| Phase | Time Remaining | Edge Required | Min Model Prob |
|-------|----------------|---------------|----------------|
| EARLY | > 40 minutes   | 5%            | 55%            |
| MID   | 20-40 minutes  | 10%           | 60%            |
| LATE  | < 20 minutes   | 20%           | 65%            |

### Technical Indicators Used
- **VWAP** - Session volume-weighted average price
- **RSI(14)** - Relative strength index with 14-period MA
- **MACD(12,26,9)** - Moving average convergence/divergence
- **Heiken Ashi** - Smoothed candlestick patterns
- **Regime Detection** - TREND_UP, TREND_DOWN, RANGE, VOLATILE

### Signal Generation
1. Fetches Coinbase 1m & 5m candles
2. Calculates all technical indicators
3. Scores directional probability (UP/DOWN)
4. Applies time-awareness decay (closer to expiration = higher certainty needed)
5. Fetches Kalshi market prices
6. Calculates edge (model_probability - market_price)
7. Applies phase-based thresholds
8. Outputs signal: BUY_YES, BUY_NO, or NO_TRADE

---

## 📈 Kalshi Market Structure

### KXBTCD Markets
- **Ticker format**: `KXBTCD-DDMMMHHMM-T{strike}` or `-B{strike}`
- **Example**: `KXBTCD-26FEB0202-T75249.99` = "Will BTC be ≥ $75,250 at 02:00 UTC?"
- **Settlement**: Top of every hour (00:00, 01:00, 02:00, etc.)
- **Strike selection**: Bot automatically picks strike closest to current BTC price
- **Contracts**: Binary YES/NO (0-100¢, settles at 0 or 100¢)

---

## 🛠️ Configuration Options

### Environment Variables
```bash
# Trading Mode
KALSHI_AUTO_TRADE=false              # Keep false for signal-only mode

# Position Sizing (unused in signal mode, but kept for compatibility)
KALSHI_MAX_POSITION=1                # Max contracts per trade
KALSHI_MIN_EDGE=0.1                  # Minimum edge (10%)

# Polling
POLL_INTERVAL_MS=2000                # Signal update frequency
```

---

## 📁 Project Structure
```
kalshi-hourly-btc-signal-generator/
├── src/
│   ├── data/
│   │   ├── coinbase.js          # Coinbase REST API
│   │   ├── coinbaseWs.js        # Coinbase WebSocket
│   │   └── kalshi.js            # Kalshi API + auth
│   ├── engines/
│   │   ├── edge-kalshi.js       # Phase logic (scaled to 60m)
│   │   ├── probability.js       # Direction scoring
│   │   └── regime.js            # Market regime detection
│   ├── indicators/
│   │   ├── vwap.js
│   │   ├── rsi.js
│   │   ├── macd.js
│   │   └── heikenAshi.js
│   ├── index-kalshi.js          # Main signal generator
│   └── config.js
├── logs/
│   ├── current-signal.json      # Latest signal (for moltbot)
│   ├── kalshi-signals.csv       # Full history
│   ├── bot-output.log           # Terminal output
│   └── bot-error.log            # Errors
└── .env                         # Your credentials (DO NOT COMMIT)
```

---

## 🔐 Security Notes

**NEVER commit your `.env` file to git!** It contains:
- Kalshi API key
- RSA private key
- Other sensitive credentials

The repo includes `.gitignore` to prevent accidental commits.

---

## 🐛 Troubleshooting

### "fs is not defined"
- Ensure Node.js v20+ is installed
- Check that `import fs from "node:fs"` exists in index-kalshi.js

### "KALSHI_API_KEY not found"
- Verify `.env` file exists in project root
- Check that `import 'dotenv/config'` is in config.js

### "current-signal.json not found"
- Wait 5-10 seconds after starting bot
- File is created after first successful poll
- Check `logs/bot-error.log` for errors

### Signals not updating
- Check bot is running: `launchctl list | grep kalshi`
- View logs: `tail -f ~/PolymarketBTC15mAssistant/logs/bot-output.log`
- Verify Coinbase API is accessible: `curl https://api.exchange.coinbase.com/products/BTC-USD/candles`

---

## 📊 Backtesting

Use the CSV log for backtesting:
```python
import pandas as pd

signals = pd.read_csv('logs/kalshi-signals.csv')

# Filter to actual trades (where edge threshold was met)
trades = signals[signals['recommendation'].str.contains('STRONG|GOOD')]

# Analyze by phase
print(trades.groupby('regime')['edge_up'].mean())
```

---

## 🙏 Credits

- **Original Polymarket Bot**: [FrondEnt/PolymarketBTC15mAssistant](https://github.com/FrondEnt/PolymarketBTC15mAssistant)
- **Adaptation**: Scaled for Kalshi hourly markets with moltbot integration

---

## 📄 License

MIT License - See original repo for details

---

## ⚠️ Disclaimer

**This is for educational purposes only.** Trading derivatives involves substantial risk of loss. Past performance does not guarantee future results. The signal generator provides analysis only - you are responsible for all trading decisions.

**Kalshi terms**: Ensure compliance with Kalshi's API terms of service and trading rules.
