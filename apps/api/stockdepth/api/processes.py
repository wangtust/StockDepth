"""Owned runner lifecycle. Registry never retains commands, environments or keys."""
import datetime as dt
import json
import subprocess
import threading
import time
from collections import OrderedDict
from pathlib import Path


class RunnerRegistry:
    def __init__(self, completed_limit=256):
        self.lock = threading.RLock()
        self.active = {}
        self.completed = OrderedDict()
        self.completed_limit = completed_limit
        self.closing = False

    def _finish(self, key, process, marker, code):
        process.wait()
        # Durable exit code survives registry eviction and an API restart. This
        # contains no request payload or credentials and is not a new HTTP API.
        temporary = marker.with_suffix('.tmp')
        temporary.write_text(json.dumps({'returncode': code, 'ended_at': dt.datetime.now(dt.timezone.utc).isoformat()}))
        temporary.replace(marker)
        # Retain ownership until durable persistence succeeds so reap can retry.
        self.active.pop(key, None)
        self.completed[key] = code
        self.completed.move_to_end(key)
        while len(self.completed) > self.completed_limit:
            self.completed.popitem(last=False)

    def reap(self):
        with self.lock:
            failure = None
            for key, (process, marker) in list(self.active.items()):
                code = process.poll()
                if code is not None:
                    try:
                        self._finish(key, process, marker, code)
                    except OSError as exc:
                        failure = exc
            if failure is not None:
                raise failure

    def status(self, key, marker):
        with self.lock:
            record = self.active.get(key)
            if record:
                process, path = record
                code = process.poll()
                if code is None:
                    return 'running', None
                self._finish(key, process, path, code)
            if key in self.completed:
                return 'exited', self.completed[key]
            try:
                code = json.loads(Path(marker).read_text())['returncode']
                if isinstance(code, int):
                    return 'exited', code
            except (OSError, ValueError, KeyError):
                pass
            return 'unknown', None

    def start(self, key, marker, completed, spawn):
        # Check and spawn occur under the same lock, including simultaneous POSTs.
        with self.lock:
            if self.closing:
                raise RuntimeError('API is shutting down')
            state, code = self.status(key, marker)
            if state == 'running':
                return self.active[key][0], 'already-running'
            if code == 0 and completed():
                return None, 'complete'
            Path(marker).unlink(missing_ok=True)
            self.completed.pop(key, None)
            process = spawn()
            self.active[key] = (process, Path(marker))
            return process, 'started'

    def shutdown(self, grace=2):
        with self.lock:
            self.closing = True
            failure = None
            deadline = time.monotonic() + grace
            for process, _ in self.active.values():
                if process.poll() is None:
                    process.terminate()
            for key, (process, marker) in list(self.active.items()):
                try:
                    code = process.wait(timeout=max(0, deadline - time.monotonic()))
                except subprocess.TimeoutExpired:
                    process.kill()
                    code = process.wait()
                try:
                    self._finish(key, process, marker, code)
                except OSError as exc:
                    failure = exc
            if failure is not None:
                raise failure
