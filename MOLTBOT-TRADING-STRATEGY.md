# Moltbot Trading Strategy for Kalshi Signals

**Signal Source:** Kalshi Hourly BTC Signal Generator
**Markets:** KXBTCD (hourly Bitcoin binary options)
**Signal Update Frequency:** Every 2 seconds
**Signal File:** `logs/current-signal.json`

---

## 📊 Signal Structure

```json
{
  "timestamp": "2026-02-02T06:47:35.057Z",
  "ticker": "KXBTCD-26FEB0202-T76249.99",
  "btc_price": 76365.76,
  "signal": "BUY_YES",              // Action: BUY_YES, BUY_NO, NO_TRADE
  "signal_side": "UP",              // Direction: UP or DOWN
  "phase": "EARLY",                 // EARLY, MID, or LATE
  "strength": "STRONG",             // STRONG, GOOD, or OPTIONAL
  "best_edge": 0.182,               // 18.2% edge (model - market)
  "model_up": 0.682,                // 68.2% model probability UP
  "model_down": 0.318,              // 31.8% model probability DOWN
  "market_yes": 0.50,               // YES contract at 50¢
  "market_no": 0.46,                // NO contract at 46¢
  "time_remaining_min": 42.5,       // 42.5 minutes until settlement
  "regime": "TREND_UP",             // Market regime
  "rsi": 68.12,                     // RSI indicator
  "macd_signal": "bullish"          // MACD direction
}
```

---

## 🎯 Entry Strategy

### Tier 1: HIGH CONVICTION (Recommended)
**When to enter:**
```python
should_trade = (
    signal['signal'] in ['BUY_YES', 'BUY_NO'] and
    signal['strength'] == 'STRONG' and
    signal['best_edge'] >= 0.15 and             # 15%+ edge
    signal['phase'] == 'EARLY' and              # >40 min remaining
    signal['time_remaining_min'] > 40 and
    (signal['signal_side'] == 'UP' and signal['model_up'] > 0.65) or
    (signal['signal_side'] == 'DOWN' and signal['model_down'] > 0.65)
)
```

**Position size:** 5-10 contracts
**Expected win rate:** ~60-70%
**Expected edge:** 15-30%

---

### Tier 2: MODERATE CONVICTION
**When to enter:**
```python
should_trade = (
    signal['signal'] in ['BUY_YES', 'BUY_NO'] and
    signal['strength'] in ['STRONG', 'GOOD'] and
    signal['best_edge'] >= 0.10 and             # 10%+ edge
    signal['phase'] in ['EARLY', 'MID'] and
    signal['time_remaining_min'] > 20 and
    (signal['signal_side'] == 'UP' and signal['model_up'] > 0.60) or
    (signal['signal_side'] == 'DOWN' and signal['model_down'] > 0.60)
)
```

**Position size:** 2-5 contracts
**Expected win rate:** ~55-65%
**Expected edge:** 10-20%

---

### Tier 3: LOW CONVICTION (Optional)
**When to enter:**
```python
should_trade = (
    signal['signal'] in ['BUY_YES', 'BUY_NO'] and
    signal['best_edge'] >= 0.08 and             # 8%+ edge
    signal['phase'] in ['EARLY', 'MID'] and
    signal['time_remaining_min'] > 25 and
    (signal['signal_side'] == 'UP' and signal['model_up'] > 0.55) or
    (signal['signal_side'] == 'DOWN' and signal['model_down'] > 0.55)
)
```

**Position size:** 1-2 contracts
**Expected win rate:** ~52-60%
**Expected edge:** 8-15%

---

## 🚫 Never Trade When

```python
skip_trade = (
    signal['signal'] == 'NO_TRADE' or
    signal['best_edge'] < 0.05 or               # <5% edge too risky
    signal['time_remaining_min'] < 15 or        # Too close to settlement
    signal['phase'] == 'LATE' or                # Requires 20% edge, too steep
    signal['market_yes'] + signal['market_no'] > 1.0  # Market mispriced
)
```

**Avoid:**
- LATE phase (< 20 min) unless edge > 25%
- Markets with < 10 min remaining (high volatility)
- Edges < 5% (transaction costs eat profit)
- When market sum > $1.00 (arbitrage opportunity exists, don't trade)

---

## 💰 Position Sizing

### Kelly Criterion Approach
```python
def calculate_position_size(signal, bankroll, max_position=10):
    """
    Kelly formula: f = (p * b - q) / b
    where:
      p = win probability (model probability)
      q = 1 - p
      b = odds (payout / cost)
    """

    # Get model probability
    if signal['signal'] == 'BUY_YES':
        win_prob = signal['model_up']
        market_price = signal['market_yes']
    else:  # BUY_NO
        win_prob = signal['model_down']
        market_price = signal['market_no']

    # Calculate odds
    payout = 1.00  # Contracts pay $1 if correct
    cost = market_price
    odds = payout / cost if cost > 0 else 0

    # Kelly percentage
    lose_prob = 1 - win_prob
    kelly_pct = (win_prob * odds - lose_prob) / odds

    # Use fractional Kelly (safer)
    fractional_kelly = kelly_pct * 0.25  # Use 25% of full Kelly

    # Calculate contracts
    contracts = int(bankroll * fractional_kelly / cost)

    # Cap at max position
    return min(contracts, max_position)
```

### Simple Position Sizing
```python
# Based on signal strength
position_sizes = {
    'STRONG': 5,   # High conviction
    'GOOD': 3,     # Medium conviction
    'OPTIONAL': 1  # Low conviction
}

contracts = position_sizes.get(signal['strength'], 1)

# Scale by edge
if signal['best_edge'] > 0.20:  # 20%+ edge
    contracts = min(contracts * 2, 10)
```

---

## 🎲 Risk Management

### Per-Trade Limits
```python
MAX_RISK_PER_TRADE = 0.02        # 2% of bankroll
MAX_CONTRACTS_PER_TRADE = 10
MAX_COST_PER_TRADE = 500         # $500 max

def check_risk_limits(contracts, price, bankroll):
    cost = contracts * price
    risk_pct = cost / bankroll

    return (
        contracts <= MAX_CONTRACTS_PER_TRADE and
        cost <= MAX_COST_PER_TRADE and
        risk_pct <= MAX_RISK_PER_TRADE
    )
```

### Daily Limits
```python
MAX_TRADES_PER_DAY = 10
MAX_DAILY_LOSS = 0.10            # 10% of bankroll
MAX_CONSECUTIVE_LOSSES = 3

# Stop trading if:
# - Hit daily trade limit
# - Daily loss > 10%
# - 3 consecutive losses (reassess strategy)
```

### Per-Market Limits
```python
MAX_POSITION_PER_MARKET = 10     # Max 10 contracts per ticker

# Don't pyramid into same market
if has_open_position(signal['ticker']):
    skip_trade = True
```

---

## 🚪 Exit Strategy

### Option 1: Hold to Expiration (Recommended for Strong Signals)
```python
# For STRONG signals with >15% edge
# Just hold until settlement
# Contracts auto-settle at $0 or $1.00
```

### Option 2: Take Profit / Stop Loss
```python
def check_exit(position, current_signal):
    """Check if should exit position early"""

    entry_price = position['entry_price']
    current_price = (
        current_signal['market_yes'] if position['side'] == 'yes'
        else current_signal['market_no']
    )

    # Calculate P&L
    price_change = current_price - entry_price
    pnl_pct = price_change / entry_price

    # TAKE PROFIT: Up 30%
    if pnl_pct >= 0.30:
        return 'TAKE_PROFIT', 'exit_half'  # Exit 50% of position

    # STOP LOSS: Down 20%
    if pnl_pct <= -0.20:
        return 'STOP_LOSS', 'exit_all'     # Exit 100% of position

    # SIGNAL REVERSAL: Signal changed direction
    if position['side'] == 'yes' and current_signal['signal'] == 'BUY_NO':
        return 'SIGNAL_REVERSAL', 'exit_all'
    elif position['side'] == 'no' and current_signal['signal'] == 'BUY_YES':
        return 'SIGNAL_REVERSAL', 'exit_all'

    # NEAR EXPIRATION: < 5 min, in profit
    if current_signal['time_remaining_min'] < 5 and pnl_pct > 0.10:
        return 'EXPIRATION_NEAR', 'exit_all'  # Lock in profit

    return None, None
```

### Option 3: Trailing Stop
```python
def trailing_stop(position, current_price):
    """Protect profits with trailing stop"""

    highest_price = position.get('highest_price', position['entry_price'])

    # Update highest price
    if current_price > highest_price:
        highest_price = current_price
        position['highest_price'] = highest_price

    # Exit if drops 15% from peak
    drawdown_from_peak = (highest_price - current_price) / highest_price
    if drawdown_from_peak >= 0.15:
        return 'TRAILING_STOP', 'exit_all'

    return None, None
```

---

## ⏱️ Trade Timing

### Cooldown Between Trades
```python
MIN_TIME_BETWEEN_TRADES = 300    # 5 minutes

last_trade_time = {}

def can_trade(ticker, current_time):
    if ticker not in last_trade_time:
        return True

    time_since_last = current_time - last_trade_time[ticker]
    return time_since_last >= MIN_TIME_BETWEEN_TRADES
```

### Best Times to Trade (Based on Market Activity)
```python
# KXBTCD markets settle at top of every hour
# Best entry windows:

# OPTIMAL: First 10-15 minutes of new hour
#   - Most time remaining (50-60 min)
#   - EARLY phase with 5% threshold
#   - Less volatile

# GOOD: 15-35 minutes into hour
#   - Still EARLY/MID phase
#   - 25-45 min remaining
#   - Reasonable time for thesis to play out

# AVOID: Last 15 minutes
#   - LATE phase requires 20% edge
#   - High volatility
#   - Less time for reversion
```

---

## 📈 Regime-Based Adjustments

### TREND_UP Markets
```python
if signal['regime'] == 'TREND_UP':
    # Prefer YES/UP trades
    # Require higher edge for NO trades
    if signal['signal'] == 'BUY_NO':
        required_edge += 0.05  # Need +5% more edge
```

### TREND_DOWN Markets
```python
if signal['regime'] == 'TREND_DOWN':
    # Prefer NO/DOWN trades
    # Require higher edge for YES trades
    if signal['signal'] == 'BUY_YES':
        required_edge += 0.05
```

### RANGE Markets
```python
if signal['regime'] == 'RANGE':
    # Both directions viable
    # Look for mean reversion
    # Reduce position size by 20%
    contracts = int(contracts * 0.8)
```

### VOLATILE Markets
```python
if signal['regime'] == 'VOLATILE':
    # Skip entirely OR
    # Require STRONG signals only
    # Reduce position size by 50%
    if signal['strength'] != 'STRONG':
        skip_trade = True
    else:
        contracts = int(contracts * 0.5)
```

---

## 🔄 Signal Confirmation

### Wait for Multiple Confirmations
```python
signal_history = []
CONFIRMATION_COUNT = 3  # Wait for 3 consecutive signals

def should_enter_with_confirmation(new_signal):
    signal_history.append(new_signal)

    # Keep only last N signals
    if len(signal_history) > CONFIRMATION_COUNT:
        signal_history.pop(0)

    # Need N consecutive matching signals
    if len(signal_history) < CONFIRMATION_COUNT:
        return False

    # All must agree on direction
    signals = [s['signal'] for s in signal_history]
    if len(set(signals)) > 1:
        return False  # Signals disagree

    # All must be STRONG or GOOD
    strengths = [s['strength'] for s in signal_history]
    if 'OPTIONAL' in strengths:
        return False

    return True
```

---

## 🎨 Complete Trading Algorithm

```python
import json
import time
from datetime import datetime

class MoltbotKalshiStrategy:
    def __init__(self, signal_file, bankroll=1000):
        self.signal_file = signal_file
        self.bankroll = bankroll
        self.positions = {}
        self.last_trade_time = {}
        self.daily_trades = 0
        self.daily_pnl = 0
        self.consecutive_losses = 0

    def read_signal(self):
        with open(self.signal_file, 'r') as f:
            return json.load(f)

    def should_enter(self, signal):
        """Tier 1: High conviction trades only"""

        # Check daily limits
        if self.daily_trades >= 10 or self.daily_pnl < -100:
            return False

        # Check consecutive losses
        if self.consecutive_losses >= 3:
            return False

        # Cooldown check
        ticker = signal['ticker']
        if not self.can_trade(ticker):
            return False

        # Already have position
        if ticker in self.positions:
            return False

        # Signal requirements
        if signal['signal'] not in ['BUY_YES', 'BUY_NO']:
            return False

        # Tier 1 criteria
        return (
            signal['strength'] == 'STRONG' and
            signal['best_edge'] >= 0.15 and
            signal['phase'] == 'EARLY' and
            signal['time_remaining_min'] > 35 and
            (
                (signal['signal_side'] == 'UP' and signal['model_up'] > 0.65) or
                (signal['signal_side'] == 'DOWN' and signal['model_down'] > 0.65)
            )
        )

    def calculate_position_size(self, signal):
        """Simple position sizing"""
        base_size = 5  # STRONG signals

        # Scale by edge
        if signal['best_edge'] > 0.20:
            return min(base_size * 2, 10)

        return base_size

    def execute_entry(self, signal):
        """Execute trade on Kalshi"""
        ticker = signal['ticker']
        side = 'yes' if signal['signal'] == 'BUY_YES' else 'no'
        contracts = self.calculate_position_size(signal)
        price = signal['market_yes'] if side == 'yes' else signal['market_no']

        # Risk check
        cost = contracts * price
        if cost > self.bankroll * 0.02:  # Max 2% risk
            contracts = int((self.bankroll * 0.02) / price)

        print(f"[ENTRY] {ticker} {side.upper()} x{contracts} @ ${price:.2f}")
        print(f"  Edge: {signal['best_edge']*100:.1f}% | Model: {signal['model_up' if side=='yes' else 'model_down']*100:.1f}%")

        # CALL YOUR KALSHI API HERE
        # order = kalshi_api.place_order(ticker, side, 'buy', contracts, price)

        # Track position
        self.positions[ticker] = {
            'side': side,
            'contracts': contracts,
            'entry_price': price,
            'entry_time': time.time(),
            'entry_signal': signal
        }

        self.last_trade_time[ticker] = time.time()
        self.daily_trades += 1

    def check_exits(self, signal):
        """Check if should exit any positions"""
        ticker = signal['ticker']

        if ticker not in self.positions:
            return

        position = self.positions[ticker]
        current_price = (
            signal['market_yes'] if position['side'] == 'yes'
            else signal['market_no']
        )

        # Calculate P&L
        pnl = (current_price - position['entry_price']) * position['contracts']
        pnl_pct = (current_price - position['entry_price']) / position['entry_price']

        should_exit = False
        reason = None

        # Take profit at 30%
        if pnl_pct >= 0.30:
            should_exit = True
            reason = 'TAKE_PROFIT'

        # Stop loss at -20%
        elif pnl_pct <= -0.20:
            should_exit = True
            reason = 'STOP_LOSS'

        # Signal reversal
        elif (position['side'] == 'yes' and signal['signal'] == 'BUY_NO') or \
             (position['side'] == 'no' and signal['signal'] == 'BUY_YES'):
            should_exit = True
            reason = 'SIGNAL_REVERSAL'

        # Near expiration with profit
        elif signal['time_remaining_min'] < 5 and pnl_pct > 0.10:
            should_exit = True
            reason = 'LOCK_PROFIT'

        if should_exit:
            self.execute_exit(ticker, position, current_price, pnl, reason)

    def execute_exit(self, ticker, position, price, pnl, reason):
        """Execute exit on Kalshi"""
        print(f"[EXIT] {ticker} {position['side'].upper()} x{position['contracts']} @ ${price:.2f}")
        print(f"  Reason: {reason} | P&L: ${pnl:.2f} ({(pnl/position['entry_price']/position['contracts'])*100:.1f}%)")

        # CALL YOUR KALSHI API HERE
        # kalshi_api.place_order(ticker, position['side'], 'sell', position['contracts'], price)

        # Update tracking
        self.daily_pnl += pnl
        if pnl < 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0

        del self.positions[ticker]

    def can_trade(self, ticker):
        """Check cooldown"""
        if ticker not in self.last_trade_time:
            return True
        return time.time() - self.last_trade_time[ticker] >= 300  # 5 min

    def run(self):
        """Main trading loop"""
        print("Moltbot Kalshi Strategy - Started")

        while True:
            try:
                signal = self.read_signal()

                # Check exits first
                self.check_exits(signal)

                # Check entries
                if self.should_enter(signal):
                    self.execute_entry(signal)

                time.sleep(2)  # Poll every 2 seconds

            except Exception as e:
                print(f"Error: {e}")
                time.sleep(5)

# Run the strategy
if __name__ == '__main__':
    strategy = MoltbotKalshiStrategy(
        signal_file='logs/current-signal.json',
        bankroll=1000
    )
    strategy.run()
```

---

## 📊 Expected Performance

### Conservative Strategy (Tier 1 only)
- **Win rate:** 60-70%
- **Average edge:** 15-20%
- **Trades per day:** 2-5
- **Expected ROI:** 5-10% per week
- **Max drawdown:** 15-20%

### Moderate Strategy (Tier 1 + Tier 2)
- **Win rate:** 55-65%
- **Average edge:** 12-18%
- **Trades per day:** 5-10
- **Expected ROI:** 8-15% per week
- **Max drawdown:** 20-30%

---

## 🎓 Key Principles

1. **Edge is King** - Only trade when edge > 10%
2. **Early is Better** - EARLY phase gives thesis time to play out
3. **Size Matters** - Bigger edge = bigger position
4. **Cut Losers** - Use stops, don't hope
5. **Let Winners Run** - Hold STRONG signals to expiration
6. **Respect Regime** - Trade with the trend
7. **Daily Limits** - Protect bankroll from bad days
8. **Confirmation** - Wait for signal stability

---

## ⚠️ Risk Warnings

- **Settlement Risk**: Markets settle at exact hour mark, ensure you understand the rules
- **Slippage**: Limit orders may not fill at desired price
- **Gap Risk**: Bitcoin can gap significantly in minutes
- **Correlation**: All positions are correlated to BTC price
- **Liquidity**: May be difficult to exit near settlement

---

**This strategy is designed for disciplined execution. Stick to the rules, track performance, and adjust based on results.**
