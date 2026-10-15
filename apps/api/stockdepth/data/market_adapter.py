"""Bounded, JSON-only Yahoo market adapter; no report parsing or model calls."""
import argparse
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation
import json
import re
import sys
from zoneinfo import ZoneInfo

# Validate Yahoo identity metadata, never infer NASDAQ from a bare symbol.
EXCHANGES = {
    'NMS': ('XNAS', 'USD', 'America/New_York'),
    'NGM': ('XNAS', 'USD', 'America/New_York'),
    'NCM': ('XNAS', 'USD', 'America/New_York'),
    'NYQ': ('XNYS', 'USD', 'America/New_York'),
    'ASE': ('XASE', 'USD', 'America/New_York'),
    'SHH': ('XSHG', 'CNY', 'Asia/Shanghai'),
    'SHZ': ('XSHE', 'CNY', 'Asia/Shanghai'),
    'HKG': ('XHKG', 'HKD', 'Asia/Hong_Kong'),
}

def decimal(value):
    d = Decimal(str(value))
    if not d.is_finite() or d <= 0 or d >= Decimal('10000000000000000'):
        raise ValueError('invalid_price')
    # Preserve source decimal digits up to schema precision; never format currency text.
    return format(d.quantize(Decimal('0.00000001')), 'f')

def identity_from_info(requested, info):
    mapping = EXCHANGES.get(info.get('exchange'))
    if not mapping or info.get('quoteType') != 'EQUITY' or info.get('symbol', '').upper() != requested:
        raise ValueError('unresolved_identity')
    exchange, currency, timezone_name = mapping
    if info.get('currency') != currency or info.get('exchangeTimezoneName') != timezone_name:
        raise ValueError('identity_metadata_mismatch')
    if exchange in ('XSHG', 'XSHE', 'XHKG'):
        suffix = {'XSHG': '.SS', 'XSHE': '.SZ', 'XHKG': '.HK'}[exchange]
        if not requested.endswith(suffix):
            raise ValueError('identity_symbol_mismatch')
    elif '.' in requested and not re.fullmatch(r'[A-Z0-9-]+', requested):
        raise ValueError('unsupported_symbol')
    ZoneInfo(timezone_name)
    return {'symbol': requested, 'exchange': exchange, 'currency': currency,
            'timezone': timezone_name, 'name': (info.get('longName') or info.get('shortName') or requested)[:160],
            'vendorSymbol': requested, 'status': 'verified'}

def quote_from_info(info, identity, now):
    stamp = info.get('regularMarketTime')
    if not isinstance(stamp, (int, float)) or isinstance(stamp, bool):
        raise ValueError('missing_quote_time')
    quoted = datetime.fromtimestamp(stamp, timezone.utc)
    if quoted > now:
        raise ValueError('future_quote_time')
    return {'price': decimal(info.get('regularMarketPrice')), 'currency': identity['currency'],
            'quotedAt': quoted.isoformat(), 'priceType': 'regular_unadjusted', 'session': 'regular'}

def fetch(symbol, categories, start=None):
    import yfinance as yf
    now = datetime.now(timezone.utc)
    ticker = yf.Ticker(symbol)
    info = ticker.get_info()  # Reused for identity and quote in the same bounded request.
    now = datetime.now(timezone.utc)
    identity = identity_from_info(symbol, info)
    result = {'identity': identity, 'fetchedAt': now.isoformat(), 'source': 'yahoo', 'errors': {}}
    if 'quote' in categories:
        try:
            result['quote'] = quote_from_info(info, identity, now)
        except (ValueError, InvalidOperation, TypeError, OverflowError):
            result['errors']['quote'] = 'invalid_quote'
    if 'daily' in categories:
        try:
            start_date = datetime.fromisoformat(start).date() if start else (now - timedelta(days=366)).date()
            start_date = max(start_date, (now - timedelta(days=370)).date())
            frame = ticker.history(start=start_date.isoformat(), end=(now + timedelta(days=1)).date().isoformat(),
                                   interval='1d', auto_adjust=False, back_adjust=False, actions=False, timeout=15)
            rows = []
            local_now = now.astimezone(ZoneInfo(identity['timezone']))
            today = local_now.date()
            close_minute = 900 if identity['exchange'] in ('XSHG', 'XSHE') else 960
            for stamp, row in frame.iterrows():
                # Today's unfinished bar is not stored as a completed daily close.
                day = stamp.date()
                if day > today or (day == today and local_now.hour * 60 + local_now.minute < close_minute + 15):
                    continue
                rows.append({'tradingDate': day.isoformat(), 'open': decimal(row['Open']),
                             'high': decimal(row['High']), 'low': decimal(row['Low']),
                             'close': decimal(row['Close']), 'volume': str(int(row['Volume'])), 'adjusted': False})
            if not rows:
                result['errors']['daily'] = 'empty_daily'
            result['daily'] = rows[-370:]
        except Exception:
            # Daily availability must not discard independently valid identity/quote.
            result['errors']['daily'] = 'invalid_or_unavailable_daily'
    result['fetchedAt'] = datetime.now(timezone.utc).isoformat()
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--symbol', required=True)
    parser.add_argument('--categories', default='identity,quote,daily')
    parser.add_argument('--start')
    args = parser.parse_args()
    symbol = args.symbol.strip().upper().replace('.SH', '.SS')
    hk = re.fullmatch(r'(\d{1,5})\.HK', symbol)
    if hk and int(hk.group(1)) > 0:
        symbol = f'{int(hk.group(1)):04d}.HK'
    if not re.fullmatch(r'[A-Z0-9^.-]{1,40}', symbol):
        raise SystemExit('invalid_symbol')
    try:
        result = fetch(symbol, args.categories.split(','), args.start)
    except Exception:
        # No raw provider payload, URL, cookies, credentials or traceback in IPC/logs.
        result = {'error': 'provider_unavailable_or_unresolved'}
    print(json.dumps(result, allow_nan=False))

if __name__ == '__main__':
    main()
