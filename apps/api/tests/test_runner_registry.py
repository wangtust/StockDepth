import base64
import concurrent.futures
import json
import subprocess
import sys
import tempfile
import threading
import urllib.request
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer

from stockdepth.api.processes import RunnerRegistry
from stockdepth.api import server as api


def test_concurrent_start_spawns_once_and_completed_exit_is_bounded():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        registry = RunnerRegistry(completed_limit=2)
        spawns = []
        def spawn():
            child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(.15)'], stdout=subprocess.DEVNULL)
            spawns.append(child)
            return child
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            outcomes = list(pool.map(lambda _: registry.start('same', root/'same.json', lambda: False, spawn), range(8)))
        assert len(spawns) == 1
        assert len({outcome[0].pid for outcome in outcomes}) == 1
        spawns[0].wait()
        registry.reap()
        assert not registry.active
        assert registry.start('same', root/'same.json', lambda: True, spawn) == (None, 'complete')
        for index in range(3):
            child, _ = registry.start(str(index), root/f'{index}.json', lambda: False,
                lambda: subprocess.Popen([sys.executable, '-c', 'pass'], stdout=subprocess.DEVNULL))
            child.wait()
            registry.reap()
        assert len(registry.completed) <= 2
        assert registry.status('same', root/'same.json') == ('exited', 0)


def test_nonzero_exit_beats_old_final_report_and_survives_restart():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root/'reports').mkdir()
        (root/'reports/final_trade_decision.md').write_text('old report')
        registry = RunnerRegistry()
        key = api.job_key('MOCK', '2026-10-13', 'test-run')
        child, _ = registry.start(key, root/'runner_exit.json', lambda: False,
            lambda: subprocess.Popen([sys.executable, '-c', 'raise SystemExit(7)'], stdout=subprocess.DEVNULL))
        child.wait()
        registry.reap()
        with patch.object(api, 'JOBS', RunnerRegistry()):
            assert api.run_status(root, 'MOCK', '2026-10-13', 'test-run') == 'failed'


def test_shutdown_waits_and_kills_uncooperative_child():
    with tempfile.TemporaryDirectory() as directory:
        registry = RunnerRegistry()
        child, _ = registry.start('hang', Path(directory)/'exit.json', lambda: False,
            lambda: subprocess.Popen([sys.executable, '-c',
                'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); print("ready",flush=True); time.sleep(60)'],
                stdout=subprocess.PIPE, text=True))
        assert child.stdout.readline().strip() == 'ready'
        registry.shutdown(grace=.05)
        assert child.returncode is not None
        assert not registry.active
        child.stdout.close()


def test_http_parallel_start_uses_mock_subprocess_only():
    original = subprocess.Popen
    with tempfile.TemporaryDirectory() as directory:
        registry = RunnerRegistry()
        children = []
        def spawn_mock(*args, **kwargs):
            child = original([sys.executable, '-c', 'import time; time.sleep(.3)'], stdout=subprocess.DEVNULL, env={})
            children.append(child)
            return child
        with patch.object(api, 'JOBS', registry), patch.object(api, 'LOGS_DIR', Path(directory)), \
             patch.object(api, 'WEB_PASSWORD', 'fixture-password'), patch.object(api.subprocess, 'Popen', spawn_mock):
            http = ThreadingHTTPServer(('127.0.0.1', 0), api.Handler)
            thread = threading.Thread(target=http.serve_forever, daemon=True)
            thread.start()
            model = {'id': 1, 'provider': 'openai-compatible', 'model': 'mock', 'api_key': 'fixture-secret'}
            body = json.dumps({'run_id': 'mock-concurrent', 'ticker': 'MOCK', 'date': '2026-10-13',
                               'models': {'quick': model, 'deep': model}}).encode()
            def request(_):
                req = urllib.request.Request(f'http://127.0.0.1:{http.server_port}/api/start', data=body,
                    headers={'Authorization': 'Basic '+base64.b64encode(b'admin:fixture-password').decode(), 'Content-Type': 'application/json'})
                with urllib.request.urlopen(req, timeout=3) as response:
                    return json.load(response)
            try:
                with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                    outcomes = list(pool.map(request, range(8)))
                assert len(children) == 1
                assert len({result['pid'] for result in outcomes}) == 1
                assert sum(result['status'] == 'started' for result in outcomes) == 1
            finally:
                http.shutdown()
                thread.join()
                http.server_close()
                registry.shutdown()
