import time
import logging
import tempfile
import threading
from collections import OrderedDict

import pandas as pd
import yfinance as yf
from yfinance.exceptions import YFRateLimitError
from stockstats import wrap
from typing import Annotated
import os
from .config import get_config
from .utils import canonical_yahoo_symbol, safe_ticker_component

logger = logging.getLogger(__name__)

# Per-process, bounded OHLCV reuse. Realtime bars expire within 60 seconds.
_OHLCV_CACHE = OrderedDict()
_OHLCV_LOCK = threading.RLock()


def _file_signature(path):
    try:
        stat = os.stat(path)
        return stat.st_mtime_ns, stat.st_size, stat.st_ino
    except FileNotFoundError:
        return None



def yf_retry(func, max_retries=3, base_delay=2.0):
    """Execute a yfinance call with exponential backoff on rate limits.

    yfinance raises YFRateLimitError on HTTP 429 responses but does not
    retry them internally. This wrapper adds retry logic specifically
    for rate limits. Other exceptions propagate immediately.
    """
    for attempt in range(max_retries + 1):
        try:
            return func()
        except YFRateLimitError:
            if attempt < max_retries:
                delay = base_delay * (2 ** attempt)
                logger.warning(f"Yahoo Finance rate limited, retrying in {delay:.0f}s (attempt {attempt + 1}/{max_retries})")
                time.sleep(delay)
            else:
                raise


def _clean_dataframe(data: pd.DataFrame) -> pd.DataFrame:
    """Normalize a stock DataFrame for stockstats: parse dates, drop invalid rows, fill price gaps."""
    data["Date"] = pd.to_datetime(data["Date"], errors="coerce")
    data = data.dropna(subset=["Date"])

    price_cols = [c for c in ["Open", "High", "Low", "Close", "Volume"] if c in data.columns]
    data[price_cols] = data[price_cols].apply(pd.to_numeric, errors="coerce")
    data = data.dropna(subset=["Close"])
    data[price_cols] = data[price_cols].ffill().bfill()

    return data


def load_ohlcv(symbol: str, curr_date: str) -> pd.DataFrame:
    """Fetch OHLCV data with caching, filtered to prevent look-ahead bias.

    Downloads 5 years of data up to today and caches per symbol. On
    subsequent calls the cache is reused. Rows after curr_date are
    filtered out so backtests never see future prices.
    """
    # Reject ticker values that would escape the cache directory when
    # interpolated into the cache filename (e.g. ``../../tmp/x``).
    safe_symbol = safe_ticker_component(symbol)

    config = get_config()
    realtime_data = bool(config.get("realtime_data"))
    curr_date_dt = pd.Timestamp.today() if realtime_data else pd.to_datetime(curr_date)

    # yfinance treats `end` as exclusive, so request tomorrow to include today
    # when today's daily bar is available from Yahoo.
    today_date = pd.Timestamp.today()
    start_date = today_date - pd.DateOffset(years=5)
    end_date = today_date + pd.DateOffset(days=1)
    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")

    os.makedirs(config["data_cache_dir"], exist_ok=True)
    data_file = os.path.join(
        config["data_cache_dir"],
        f"{safe_symbol}-YFin-data-{start_str}-{end_str}.csv",
    )

    includes_today = curr_date_dt.normalize() >= today_date.normalize()

    key = (data_file, curr_date_dt.normalize().isoformat(), realtime_data)
    with _OHLCV_LOCK:
        cached = _OHLCV_CACHE.get(key)
        if cached and cached[0] > time.monotonic() and cached[1] == _file_signature(data_file):
            _OHLCV_CACHE.move_to_end(key)
            return cached[2].copy(deep=True)

    if os.path.exists(data_file) and not includes_today:
        data = pd.read_csv(data_file, on_bad_lines="skip", encoding="utf-8")
    else:
        data = yf_retry(lambda: yf.download(
            canonical_yahoo_symbol(symbol),
            start=start_str,
            end=end_str,
            multi_level_index=False,
            progress=False,
            auto_adjust=True,
        ))
        data = data.reset_index()
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=config["data_cache_dir"], suffix=".csv.tmp", delete=False) as file:
                temporary = file.name
            data.to_csv(temporary, index=False, encoding="utf-8")
            os.replace(temporary, data_file)
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)

    # Apply the cutoff before filling gaps: future rows must never backfill
    # missing historical prices. Preserve local trading dates, ignoring timezone.
    dates = pd.to_datetime(data["Date"], errors="coerce")
    if dates.dt.tz is not None:
        dates = dates.dt.tz_localize(None)
    data["Date"] = dates
    data = _clean_dataframe(data[dates <= curr_date_dt].copy())
    with _OHLCV_LOCK:
        _OHLCV_CACHE[key] = (time.monotonic() + (60 if includes_today else 300), _file_signature(data_file), data.copy(deep=True))
        _OHLCV_CACHE.move_to_end(key)
        while len(_OHLCV_CACHE) > 32:
            _OHLCV_CACHE.popitem(last=False)

    return data


def latest_ohlcv_date(symbol: str, curr_date: str) -> str:
    data = load_ohlcv(symbol, curr_date)
    if data.empty:
        return curr_date
    return data["Date"].max().strftime("%Y-%m-%d")


def filter_financials_by_date(data: pd.DataFrame, curr_date: str) -> pd.DataFrame:
    """Drop financial statement columns (fiscal period timestamps) after curr_date.

    yfinance financial statements use fiscal period end dates as columns.
    Columns after curr_date represent future data and are removed to
    prevent look-ahead bias.
    """
    if not curr_date or data.empty:
        return data
    cutoff = pd.Timestamp(curr_date)
    mask = pd.to_datetime(data.columns, errors="coerce") <= cutoff
    return data.loc[:, mask]


class StockstatsUtils:
    @staticmethod
    def get_stock_stats(
        symbol: Annotated[str, "ticker symbol for the company"],
        indicator: Annotated[
            str, "quantitative indicators based off of the stock data for the company"
        ],
        curr_date: Annotated[
            str, "curr date for retrieving stock price data, YYYY-mm-dd"
        ],
    ):
        data = load_ohlcv(symbol, curr_date)
        df = wrap(data)
        df["Date"] = df["Date"].dt.strftime("%Y-%m-%d")
        curr_date_str = pd.to_datetime(curr_date).strftime("%Y-%m-%d")

        df[indicator]  # trigger stockstats to calculate the indicator
        matching_rows = df[df["Date"].str.startswith(curr_date_str)]

        if not matching_rows.empty:
            indicator_value = matching_rows[indicator].values[0]
            return indicator_value
        else:
            return "N/A: Not a trading day (weekend or holiday)"
