"""Local subprocess lifecycle fault regression; no provider or database."""
import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch
import pytest
from stockdepth.api.processes import RunnerRegistry


def test_exit_marker_failure_remains_retryable(tmp_path):
    registry = RunnerRegistry()
    marker = tmp_path / 'exit.json'
    child, _ = registry.start('fault', marker, lambda: False,
        lambda: subprocess.Popen([sys.executable, '-c', 'raise SystemExit(7)']))
    child.wait(timeout=3)
    original = Path.write_text
    def fail(path, *args, **kwargs):
        if path == marker.with_suffix('.tmp'):
            raise OSError('injected isolated disk failure')
        return original(path, *args, **kwargs)
    with patch.object(Path, 'write_text', fail), pytest.raises(OSError):
        registry.reap()
    assert 'fault' in registry.active
    registry.reap()
    assert not registry.active
    assert RunnerRegistry().status('fault', marker) == ('exited', 7)
    assert json.loads(marker.read_text())['returncode'] == 7


@pytest.mark.parametrize('operation', ['reap', 'shutdown'])
def test_marker_fault_does_not_prevent_other_child_cleanup(tmp_path, operation):
    registry = RunnerRegistry()
    children = []
    for name in ['broken', 'healthy']:
        hanging = operation == 'shutdown' and name == 'healthy'
        code = ('import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); '
                'print("ready",flush=True); time.sleep(60)') if hanging else 'pass'
        child, _ = registry.start(name, tmp_path / f'{name}.json', lambda: False,
            lambda: subprocess.Popen([sys.executable, '-c', code], stdout=subprocess.PIPE, text=True))
        if hanging:
            assert child.stdout.readline().strip() == 'ready'
        else:
            child.wait(timeout=3)
        children.append(child)
    original = Path.replace
    def fail(path, target):
        if path.name == 'broken.tmp':
            raise OSError('injected isolated replace failure')
        return original(path, target)
    with patch.object(Path, 'replace', fail), pytest.raises(OSError):
        registry.shutdown(grace=.05) if operation == 'shutdown' else registry.reap()
    assert list(registry.active) == ['broken']
    assert all(child.poll() is not None for child in children)
    assert RunnerRegistry().status('healthy', tmp_path/'healthy.json') == ('exited', -9 if operation == 'shutdown' else 0)
    for child in children:
        child.stdout.close()
    registry.reap()
    assert not registry.active


def test_real_sdk_timeout_against_local_mock_only():
    import threading
    import time
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from openai import APITimeoutError
    from stockdepth.providers.factory import create_llm_client
    requests = []
    class SlowMock(BaseHTTPRequestHandler):
        def do_POST(self):
            requests.append(self.path)
            self.rfile.read(int(self.headers['Content-Length']))
            time.sleep(.3)
            try:
                self.send_response(200); self.end_headers(); self.wfile.write(b'{}')
            except (BrokenPipeError, ConnectionResetError):
                pass
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), SlowMock)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    try:
        with patch.dict('os.environ', OPENAI_API_KEY='fixture-only'):
            client = create_llm_client('openai-compatible', 'hy4-preview',
                f'http://127.0.0.1:{server.server_port}/v1', timeout=.05, max_retries=0).get_llm()
            begin = time.monotonic()
            with pytest.raises(APITimeoutError):
                client.invoke('local Mock timeout')
            assert time.monotonic()-begin < 2
            assert requests == ['/v1/chat/completions']
    finally:
        server.shutdown(); thread.join(timeout=3); server.server_close()
