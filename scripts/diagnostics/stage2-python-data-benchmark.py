"""Mock Yahoo requests and isolated status/body serialization comparison."""
import importlib.util
import json
import hashlib
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch
import pandas as pd
from stockdepth.api import server
from stockdepth.data import stockstats_utils as stocks, y_finance as yahoo

def before_module(name, relative):
    source = Path('var/codex-performance-team/stage2-python-before/apps/api/stockdepth') / relative
    spec = importlib.util.spec_from_file_location(name, source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

baseline = '--before' in sys.argv
if baseline:
    server = before_module('stage2_before_server', 'api/server.py')
    stocks = before_module('stockdepth.data.stage2_before_stocks', 'data/stockstats_utils.py')
    yahoo = before_module('stockdepth.data.stage2_before_yahoo', 'data/y_finance.py')
results = {}
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    reports = root / 'reports'; reports.mkdir()
    (reports / 'market_report.md').write_text('报告' * 50000)
    start = time.perf_counter()
    for _ in range(100):
        payload = server.read_report_files(root) if baseline else server.read_report_files(root, False)
        data = json.dumps(payload, ensure_ascii=False).encode()
    results['status'] = {'100_polls_ms': (time.perf_counter() - start) * 1000, 'report_metadata_or_body_bytes_per_poll': len(data)}
    today = pd.Timestamp.today().normalize()
    date = (today - pd.Timedelta(days=1)).strftime('%Y-%m-%d')
    frame = pd.DataFrame({'Date': pd.date_range(end=today, periods=300), 'Open': range(300), 'High': range(300), 'Low': range(300), 'Close': range(300), 'Volume': [100] * 300}).set_index('Date')
    with patch.object(stocks, 'get_config', return_value={'data_cache_dir': directory, 'realtime_data': False}), patch.object(stocks.yf, 'download', return_value=frame) as download, patch.object(stocks.pd, 'read_csv', wraps=pd.read_csv) as reads:
        start=time.perf_counter()
        for _ in range(20):
            historical_frame = stocks.load_ohlcv('MOCK', date)
        results['historical_ohlcv'] = {'20_reads_ms': (time.perf_counter()-start)*1000, 'mock_downloads': download.call_count, 'csv_reads': reads.call_count, 'output_sha256': hashlib.sha256(historical_frame.to_csv(index=False).encode()).hexdigest()}
    with patch.object(stocks, 'get_config', return_value={'data_cache_dir': directory, 'realtime_data': False}), patch.object(stocks.yf, 'download', return_value=frame) as download:
        start=time.perf_counter()
        for _ in range(20):
            stocks.load_ohlcv('MOCK', today.strftime('%Y-%m-%d'))
        results['current_day_ohlcv'] = {'20_reads_ms': (time.perf_counter()-start)*1000, 'mock_downloads': download.call_count}
    with patch.object(yahoo, 'get_config', return_value={'data_cache_dir': directory, 'realtime_data': False}), patch.object(yahoo.yf, 'Ticker') as ticker, patch.object(yahoo, '_verified_identity_header', return_value=''):
        ticker.return_value.history.return_value = frame.copy()
        start=time.perf_counter()
        for _ in range(20):
            history_report = yahoo.get_YFin_data_online('MOCK', '2026-01-01', '2026-01-02')
        results['historical_history'] = {'20_reads_ms': (time.perf_counter()-start)*1000, 'mock_history_calls': ticker.return_value.history.call_count, 'output_sha256': hashlib.sha256('\n'.join(line for line in history_report.splitlines() if not line.startswith('# Data retrieved on:')).encode()).hexdigest()}
Path(sys.argv[1]).write_text(json.dumps(results, indent=2))
print(json.dumps(results, indent=2))
