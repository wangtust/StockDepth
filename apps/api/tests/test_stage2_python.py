"""Stage 2 isolated persistence, compatibility and market boundaries."""
import json
import datetime
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
import pandas as pd
from langchain_core.messages import AIMessage, ToolMessage
from stockdepth.api import analysis_runner as runner
from stockdepth.api import server
from stockdepth.data import stockstats_utils as stocks


class ReportClock(datetime.datetime):
    current = datetime.datetime(2026, 10, 14)

    @classmethod
    def now(cls, tz=None):
        return cls.current if tz is None else cls.current.replace(tzinfo=datetime.timezone.utc).astimezone(tz)


class PersistenceTests(unittest.TestCase):
    def test_complete_cross_second_recovery_retains_metadata_and_version(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(runner.dt, 'datetime', ReportClock):
            path = Path(directory) / 'reports/complete_report.md'
            state = {'market_report': 'same\n\nGenerated: body text must remain significant'}
            ReportClock.current = datetime.datetime(2026, 10, 14, 0, 0, 0)
            cache = runner.ReportPersistence()
            cache.save_complete(state, path, 'MOCK', runner.build_complete_report)
            before = path.read_bytes()
            stamp = runner.signature(path)
            version = server.report_version(server.read_report_files(Path(directory), False))
            ReportClock.current = datetime.datetime(2026, 10, 14, 0, 1, 0)
            with patch.object(Path, 'replace', wraps=Path.replace) as replace:
                cache.save_complete(state, path, 'MOCK', runner.build_complete_report)
                runner.ReportPersistence().save_complete(state, path, 'MOCK', runner.build_complete_report)
                self.assertEqual(replace.call_count, 0)
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(runner.signature(path), stamp)
            self.assertEqual(server.report_version(server.read_report_files(Path(directory), False)), version)

    def test_complete_recovery_detects_title_body_and_body_generated_changes(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(runner.dt, 'datetime', ReportClock):
            path = Path(directory) / 'reports/complete_report.md'
            state = {'market_report': 'same\n\nGenerated: body one'}
            ReportClock.current = datetime.datetime(2026, 10, 14, 0, 0, 0)
            runner.ReportPersistence().save_complete(state, path, 'MOCK', runner.build_complete_report)
            for ticker, body in [('OTHER', state['market_report']),
                                 ('OTHER', 'changed\n\nGenerated: body one'),
                                 ('OTHER', 'changed\n\nGenerated: body two')]:
                with self.subTest(ticker=ticker, body=body):
                    before = path.read_bytes()
                    ReportClock.current += datetime.timedelta(seconds=60)
                    state['market_report'] = body
                    with patch.object(Path, 'replace', autospec=True, side_effect=Path.replace) as replace:
                        runner.ReportPersistence().save_complete(state, path, ticker, runner.build_complete_report)
                    self.assertEqual(replace.call_count, 1)
                    self.assertNotEqual(path.read_bytes(), before)
                    self.assertEqual(path.read_text(), runner.build_complete_report(state, ticker))

    def test_unchanged_mutation_and_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); reports = root / 'reports'
            cache = runner.ReportPersistence()
            state = {'market_report': 'same', 'nested': {'fee': Decimal('0.123400')},
                     'messages': [AIMessage(content='public', id='one')]}
            def save(p):
                runner.save_progress(state, reports, p)
                runner.save_report_parts(state, reports, p)
                runner.save_state_json(state, root / 'latest_state.json', p)
                p.save_complete(state, reports / 'complete_report.md', 'MOCK', runner.build_complete_report)
            save(cache)
            versions = {p: p.stat().st_mtime_ns for p in root.rglob('*') if p.is_file()}
            with patch.object(runner.json, 'dumps', wraps=json.dumps) as dumps:
                save(cache)
                self.assertEqual(dumps.call_count, 0)
            self.assertEqual(versions, {p: p.stat().st_mtime_ns for p in versions})
            save(runner.ReportPersistence())  # simulated process recovery
            self.assertEqual(versions, {p: p.stat().st_mtime_ns for p in versions})
            state['nested']['fee'] = Decimal('0.223400')
            save(cache)
            self.assertEqual(json.loads((root / 'latest_state.json').read_text())['nested']['fee'], '0.223400')
            state['messages'] = [ToolMessage(content='result', tool_call_id='call', id='two')]
            save(cache)
            self.assertIn('public', (reports / 'progress.md').read_text())
            self.assertIn('result', (reports / 'progress.md').read_text())
            (reports / 'market_report.md').unlink()
            save(cache)
            self.assertEqual((reports / 'market_report.md').read_text(), 'same')

    def test_atomic_failure_and_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'report.md'; cache = runner.ReportPersistence()
            cache.write(path, 'old')
            with patch.object(Path, 'replace', side_effect=OSError('simulated interruption')):
                with self.assertRaises(OSError):
                    cache.write(path, 'new')
            self.assertEqual(path.read_text(), 'old')
            self.assertEqual(list(path.parent.glob('*.tmp')), [])
            cache.write(path, 'new')
            self.assertEqual(path.read_text(), 'new')

    def test_light_metadata_and_legacy_alias(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); path = root / 'reports/1_analysts/market.md'
            runner.write_text(path, 'body')
            with patch.object(Path, 'read_text', side_effect=AssertionError('body read')):
                metadata = server.read_report_files(root, include_content=False)
            self.assertNotIn('content', metadata[0]); self.assertNotIn('path', metadata[0])
            first = server.report_version(metadata)
            self.assertEqual(first, server.report_version(server.read_report_files(root)))
            runner.write_text(path, 'changed')
            self.assertNotEqual(first, server.report_version(server.read_report_files(root, False)))
            self.assertEqual(server.read_report_files(root)[0]['content'], 'changed')


class MarketTests(unittest.TestCase):
    def setUp(self):
        stocks._OHLCV_CACHE.clear()

    def test_cache_isolation_expiry_and_no_future_backfill(self):
        frame = pd.DataFrame({'Date': pd.to_datetime(['2026-01-01', '2026-01-02']),
                              'Open': [None, 99.], 'High': [None, 100.], 'Low': [None, 98.],
                              'Close': [10., 20.], 'Volume': [1, 2]})
        with tempfile.TemporaryDirectory() as directory, patch.object(stocks, 'get_config', return_value={'data_cache_dir': directory, 'realtime_data': False}), patch.object(stocks.yf, 'download', return_value=frame.set_index('Date')) as download:
            one = stocks.load_ohlcv('MOCK', '2026-01-01')
            self.assertEqual(len(one), 1); self.assertTrue(pd.isna(one.iloc[0]['Open']))
            one.loc[one.index[0], 'Close'] = 999
            with patch.object(stocks.pd, 'read_csv', side_effect=AssertionError('duplicate CSV read')):
                two = stocks.load_ohlcv('MOCK', '2026-01-01')
            self.assertEqual(two.iloc[0]['Close'], 10.)
            later = stocks.load_ohlcv('MOCK', '2026-01-02')
            self.assertEqual(len(later), 2); self.assertEqual(download.call_count, 1)
            self.assertFalse(list(Path(directory).glob('*.tmp')))

    def test_realtime_ttl_and_timezone_cutoff(self):
        now = pd.Timestamp.today().normalize()
        frame = pd.DataFrame({'Date': pd.DatetimeIndex([now, now + pd.Timedelta(days=1)]).tz_localize('America/New_York'),
                              'Close': [10., 20.]})
        with tempfile.TemporaryDirectory() as directory, patch.object(stocks, 'get_config', return_value={'data_cache_dir': directory, 'realtime_data': False}), patch.object(stocks.yf, 'download', return_value=frame.set_index('Date')) as download, patch.object(stocks.time, 'monotonic', return_value=1) as clock:
            date = now.strftime('%Y-%m-%d')
            self.assertEqual(len(stocks.load_ohlcv('MOCK', date)), 1)
            stocks.load_ohlcv('MOCK', date)
            self.assertEqual(download.call_count, 1)
            clock.return_value = 62
            stocks.load_ohlcv('MOCK', date)
            self.assertEqual(download.call_count, 2)
            self.assertEqual(download.call_args.kwargs['end'], (now + pd.Timedelta(days=1)).strftime('%Y-%m-%d'))

    def test_history_end_inclusive_and_format_does_not_mutate_cache(self):
        from stockdepth.data import y_finance as yahoo
        yahoo._historical_frame.cache_clear()
        index = pd.date_range('2026-01-01', periods=2, tz='America/New_York', name='Date')
        frame = pd.DataFrame({'Close': [10.12345, 20.67891]}, index=index)
        with tempfile.TemporaryDirectory() as directory, patch.object(yahoo, 'get_config', return_value={'data_cache_dir': directory, 'realtime_data': False}), patch.object(yahoo.yf, 'Ticker') as ticker, patch.object(yahoo.time, 'monotonic', return_value=1) as clock, patch.object(yahoo, '_verified_identity_header', return_value=''):
            ticker.return_value.history.return_value = frame
            first = yahoo.get_YFin_data_online('MOCK', '2026-01-01', '2026-01-02')
            second = yahoo.get_YFin_data_online('MOCK', '2026-01-01', '2026-01-02')
            self.assertEqual(first, second)
            self.assertEqual(ticker.return_value.history.call_count, 1)
            self.assertEqual(ticker.return_value.history.call_args.kwargs['end'], '2026-01-03')
            self.assertEqual(frame.iloc[0]['Close'], 10.12345)
            self.assertIsNotNone(frame.index.tz)
            clock.return_value = 61
            yahoo.get_YFin_data_online('MOCK', '2026-01-01', '2026-01-02')
            self.assertEqual(ticker.return_value.history.call_count, 2)
            with self.assertRaises(ValueError):
                yahoo.get_YFin_data_online('MOCK', '2026-01-03', '2026-01-02')


class StatusHTTPTests(unittest.TestCase):
    def test_endpoint_auth_legacy_usage_and_failed_diagnostics(self):
        import base64
        import threading
        import urllib.request
        import urllib.error
        from http.server import ThreadingHTTPServer
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'LOGS_DIR', Path(directory)), patch.object(server, 'WEB_USERNAME', 'mock-user'), patch.object(server, 'WEB_PASSWORD', 'mock-only'):
            root = Path(directory) / 'runs/mock-run'
            runner.write_text(root / 'reports/market_report.md', 'body')
            usage = {'calls': [{'model_role': 'quick', 'provider': 'mock', 'model_config_id': 'isolated', 'input_tokens': 20, 'input_price': '0.123400'}], 'history_complete': True}
            runner.write_text(root / 'usage.json', json.dumps(usage))
            http = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
            thread = threading.Thread(target=http.serve_forever, daemon=True); thread.start()
            base = f'http://127.0.0.1:{http.server_port}'
            auth = 'Basic ' + base64.b64encode(b'mock-user:mock-only').decode()
            def get(path):
                with urllib.request.urlopen(urllib.request.Request(base + path, headers={'Authorization': auth}), timeout=3) as response:
                    return json.load(response)
            try:
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(base + '/api/run/status?run_id=mock-run', timeout=3)
                self.assertEqual(error.exception.code, 401)
                light = get('/api/run/status?run_id=mock-run')
                full = get('/api/run?run_id=mock-run')
                self.assertEqual(light['usage'], usage); self.assertEqual(full['usage'], usage)
                self.assertEqual(light['report_version'], full['report_version'])
                self.assertNotIn('content', light['reports'][0]); self.assertNotIn('runner_log', light)
                self.assertEqual(full['reports'][0]['content'], 'body')
                runner.write_text(root / 'web_runner.log', 'Analysis failed: mock error\n' + 'x' * 5000)
                failed = get('/api/run/status?run_id=mock-run')
                self.assertEqual(failed['status'], 'failed'); self.assertEqual(len(failed['runner_log']), 4000)
                with self.assertRaises(urllib.error.HTTPError) as invalid:
                    get('/api/run/status?run_id=../outside')
                self.assertEqual(invalid.exception.code, 400)
                legacy = Path(directory) / 'MOCK/2026-01-01'
                runner.write_text(legacy / 'reports/5_portfolio/decision.md', 'hold')
                old = get('/api/run/status?ticker=MOCK&date=2026-01-01')
                self.assertEqual(old['status'], 'complete'); self.assertIsNone(old['run_id'])
            finally:
                http.shutdown(); http.server_close(); thread.join(timeout=3)


class AtomicReaderTests(unittest.TestCase):
    def test_readers_observe_only_complete_replacements(self):
        import threading
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'report.md'
            before = '旧报告' * 10000; after = '新报告' * 20000
            cache = runner.ReportPersistence(); cache.write(path, before)
            stop = threading.Event(); invalid = []; reads = []
            def reader():
                while not stop.is_set():
                    content = path.read_text()
                    reads.append(len(content))
                    if content not in (before, after):
                        invalid.append(content)
            thread = threading.Thread(target=reader); thread.start()
            try:
                for index in range(50):
                    cache.write(path, after if index % 2 == 0 else before)
            finally:
                stop.set(); thread.join(timeout=3)
            self.assertTrue(reads); self.assertFalse(invalid); self.assertFalse(thread.is_alive())
