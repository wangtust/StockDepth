"""Host-wide in-flight limit shared by runner processes; kernel releases on exit.

The callback brackets a logical SDK call, including its bounded retries. RPM is
still handled by ProviderRateLimiter. This applies to sync analysis invocation;
all models constructed by StockDepthGraph inherit the same gate in tool bindings
and structured output. No request is replayed when acquiring capacity fails.
"""
import fcntl
import hashlib
import math
import os
from pathlib import Path
import tempfile
import threading
import time

from langchain_core.callbacks import BaseCallbackHandler


class RequestGate(BaseCallbackHandler):
    raise_error = True
    run_inline = True

    def __init__(self, scope, capacity=1, wait_timeout=600, directory=None):
        if type(capacity) is not int or not 1 <= capacity <= 10000:
            raise ValueError('request_concurrency must be an integer between 1 and 10000')
        if not math.isfinite(wait_timeout) or wait_timeout <= 0:
            raise ValueError('request queue timeout must be positive and finite')
        root = Path(directory or os.getenv('STOCKDEPTH_RATE_LIMIT_DIR') or
                    Path(tempfile.gettempdir()) / f'stockdepth-rate-limits-{os.getuid()}')
        self.root = root / ('inflight-' + hashlib.sha256(scope.encode()).hexdigest())
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.capacity = capacity
        self.wait_timeout = wait_timeout
        self.held = {}
        self.mutex = threading.Lock()

    def on_chat_model_start(self, serialized, messages, *, run_id, **kwargs):
        with self.mutex:
            if run_id in self.held:
                return
        deadline = time.monotonic() + self.wait_timeout
        while True:
            with (self.root / 'schedule.lock').open('a') as schedule:
                fcntl.flock(schedule, fcntl.LOCK_EX)
                active_limits = []
                available = None
                paths = list(self.root.glob('*.slot'))
                for path in paths:
                    handle = path.open('r+')
                    try:
                        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    except BlockingIOError:
                        try:
                            active_limits.append(int(handle.read()))
                        except ValueError:
                            active_limits.append(1)
                    else:
                        if available is None:
                            available = path
                    finally:
                        handle.close()
                ceiling = min([self.capacity, *active_limits])
                if len(active_limits) < ceiling:
                    # Mixed historical/current model snapshots share the most
                    # conservative limit among active calls for this scope.
                    path = available or self.root / f'{len(paths)}.slot'
                    handle = path.open('w+')
                    fcntl.flock(handle, fcntl.LOCK_EX)
                    handle.write(str(self.capacity))
                    handle.flush()
                    with self.mutex:
                        self.held[run_id] = handle
                    return
            if time.monotonic() >= deadline:
                raise TimeoutError('Model request capacity queue timed out')
            time.sleep(min(.05, max(0, deadline - time.monotonic())))

    def _release(self, run_id):
        with self.mutex:
            handle = self.held.pop(run_id, None)
        if handle:
            handle.close()

    def on_llm_end(self, response, *, run_id, **kwargs):
        self._release(run_id)

    def on_llm_error(self, error, *, run_id, **kwargs):
        self._release(run_id)
