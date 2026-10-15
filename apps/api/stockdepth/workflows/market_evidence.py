"""A deterministic, dated market snapshot shared by all agents in a run."""
from datetime import date, timedelta
from io import StringIO
import json
import math
import pandas as pd
from stockdepth.data.interface import route_to_vendor


def build_market_evidence(ticker, cutoff):
    end = date.fromisoformat(cutoff)
    raw = route_to_vendor('get_stock_data', ticker, (end - timedelta(days=420)).isoformat(), cutoff)
    frame = pd.read_csv(StringIO(raw), comment='#')
    frame.columns = [str(c).strip().lower() for c in frame.columns]
    column = next((c for c in ('date', 'datetime', 'timestamp') if c in frame), None)
    if column is None or 'close' not in frame:
        raise ValueError('Dated closing prices are unavailable')
    frame['date'] = pd.to_datetime(frame[column].astype(str).str.slice(0, 10), errors='coerce').dt.date
    frame['close'] = pd.to_numeric(frame['close'], errors='coerce')
    frame = frame.dropna(subset=['date', 'close'])
    frame = frame[(frame['date'] <= end) & (frame['close'] > 0)]
    frame = frame[frame['close'].map(math.isfinite)].sort_values('date').drop_duplicates('date', keep='last')
    if frame.empty:
        raise ValueError('No valid prices on or before the analysis date')
    close = frame['close']
    values = {'source': 'configured OHLCV vendor', 'ticker': ticker, 'as_of': cutoff, 'latest_bar_date': str(frame.iloc[-1]['date']),
              'close': float(close.iloc[-1]), 'bars': len(frame),
              'recent_closes': [{'date': str(r['date']), 'close': float(r['close'])} for _, r in frame.tail(5).iterrows()]}
    for period in (20, 50, 200):
        if len(close) >= period:
            values[f'sma_{period}'] = float(close.tail(period).mean())
    if len(close) >= 15:
        change = close.diff()
        gain, loss = change.clip(lower=0).tail(14).mean(), (-change.clip(upper=0)).tail(14).mean()
        values['rsi_14_simple'] = float(100 - 100 / (1 + gain / loss)) if loss else (100.0 if gain else 50.0)
    if len(frame) >= 15 and all(key in frame for key in ('high', 'low')):
        high, low = pd.to_numeric(frame['high'], errors='coerce'), pd.to_numeric(frame['low'], errors='coerce')
        ranges = pd.concat([high - low, (high - close.shift()).abs(), (low - close.shift()).abs()], axis=1)
        atr = ranges.max(axis=1).tail(14).mean()
        valid_range = (high >= low) & (high >= close) & (low <= close)
        if valid_range.tail(15).all() and math.isfinite(atr) and atr >= 0:
            values['atr_14_simple'] = float(atr)
    # Explicit period convention avoids presenting unlike indicators as equal.
    return values


def market_evidence_node(state):
    try:
        from stockdepth.data.config import get_config
        cutoff = date.today().isoformat() if get_config().get('realtime_data') else state['trade_date']
        snapshot = build_market_evidence(state['company_of_interest'], cutoff)
        evidence = ('Verified market evidence (vendor OHLCV, deterministic calculations; use latest_bar_date for freshness; '
                    'RSI uses simple 14-bar means):\n' + json.dumps(snapshot, allow_nan=False))
        return {'market_snapshot': snapshot, 'market_evidence': evidence}
    except Exception as error:
        # Never include provider responses/credentials in public diagnostics.
        return {'market_snapshot': {}, 'market_evidence': f'[MARKET EVIDENCE UNAVAILABLE] {type(error).__name__}. Do not invent numeric prices or indicators.'}
