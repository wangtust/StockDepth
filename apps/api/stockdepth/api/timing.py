"""Bounded, opt-out execution timing; never persists prompts or tool arguments."""
import contextlib
import contextvars
import datetime as dt
import json
import threading
import time
from collections import deque
from pathlib import Path
from langchain_core.callbacks import BaseCallbackHandler

CURRENT_TIMING = contextvars.ContextVar('stockdepth_timing', default=None)


class TimingRecorder(BaseCallbackHandler):
    def __init__(self, directory: Path, job_id=None, max_events=1000, max_bytes=5_000_000):
        self.directory = Path(directory)
        self.job_id = job_id
        self.pending = {}
        self.events = deque(maxlen=max_events)
        self.summary = {}
        self.max_bytes = max_bytes
        self.dropped = 0
        self.last_flush = 0
        self.lock = threading.RLock()
        self.closed = False

    def _start(self, kind, name, run_id, metadata=None, parent_run_id=None):
        with self.lock:
            if len(self.pending) >= 4096:
                self.dropped += 1
                return
            key = str(run_id)
            if key in self.pending:
                return
            metadata = metadata or {}
            self.pending[key] = (time.perf_counter_ns(), {
                'kind': kind, 'name': str(name)[:160], 'call_id': key,
                'parent_id': str(parent_run_id) if parent_run_id else None,
                'agent': str(metadata.get('langgraph_node', ''))[:160],
                'role': metadata.get('model_role'), 'model_config_id': metadata.get('model_config_id'),
            })

    def _record(self, event):
        with self.lock:
            if len(self.events) == self.events.maxlen:
                self.dropped += 1
            self.events.append({**event, 'job_id': self.job_id, 'at': dt.datetime.now(dt.timezone.utc).isoformat()})
            key = (event['kind'], event['name'], event.get('role'), event.get('model_config_id'))
            if key not in self.summary and len(self.summary) >= 512:
                self.dropped += 1
                return
            group = self.summary.setdefault(key, {'kind': key[0], 'name': key[1], 'role': key[2], 'model_config_id': key[3],
                'count': 0, 'errors': 0, 'total_ms': 0, 'max_ms': 0})
            group['count'] += 1
            group['errors'] += event['status'] != 'complete'
            group['total_ms'] += event['duration_ms']
            group['max_ms'] = max(group['max_ms'], event['duration_ms'])

    def _finish(self, run_id, status='complete'):
        with self.lock:
            entry = self.pending.pop(str(run_id), None)
            if entry:
                start, event = entry
                self._record({**event, 'duration_ms': (time.perf_counter_ns()-start)/1_000_000, 'status': status})

    def on_chain_start(self, serialized, inputs, *, run_id, parent_run_id=None, metadata=None, **kwargs):
        node = (metadata or {}).get('langgraph_node')
        # A node's nested prompts/RunnableSequences inherit its metadata. Only
        # the node itself is an Agent span, not every nested chain.
        if node and kwargs.get('name') == node:
            kind = 'node' if node.startswith(('tools_', 'Msg Clear')) else 'agent'
            self._start(kind, node, run_id, metadata, parent_run_id)

    def on_chain_end(self, outputs, *, run_id, **kwargs):
        self._finish(run_id)

    def on_chain_error(self, error, *, run_id, **kwargs):
        self._finish(run_id, 'failed')

    def on_chat_model_start(self, serialized, messages, *, run_id, parent_run_id=None, metadata=None, **kwargs):
        self._start('model', (metadata or {}).get('model_name') or (metadata or {}).get('ls_model_name') or 'model', run_id, metadata, parent_run_id)

    def on_llm_end(self, response, *, run_id, **kwargs):
        self._finish(run_id)

    def on_llm_error(self, error, *, run_id, **kwargs):
        self._finish(run_id, 'failed')

    def on_tool_start(self, serialized, input_str, *, run_id, parent_run_id=None, metadata=None, **kwargs):
        self._start('tool', (serialized or {}).get('name', 'tool'), run_id, metadata, parent_run_id)

    def on_tool_end(self, output, *, run_id, **kwargs):
        self._finish(run_id)

    def on_tool_error(self, error, *, run_id, **kwargs):
        self._finish(run_id, 'failed')

    @contextlib.contextmanager
    def measure(self, kind, name, bytes_count=None):
        start = time.perf_counter_ns()
        status = 'complete'
        try:
            yield
        except BaseException:
            status = 'failed'
            raise
        finally:
            if callable(bytes_count):
                try:
                    bytes_count = bytes_count() if status == 'complete' else None
                except OSError:
                    bytes_count = None
            self._record({'kind': kind, 'name': name, 'duration_ms': (time.perf_counter_ns()-start)/1_000_000,
                          'status': status, 'bytes': bytes_count})

    def flush(self, force=False):
        try:
            self._flush(force)
        except OSError:
            # Optional telemetry cannot turn a successful analysis into failure.
            self.dropped += len(self.events)
            self.events.clear()

    def _flush(self, force=False):
        with self.lock:
            if not force and time.monotonic() - self.last_flush < 1:
                return
            if not self.events and not force:
                return
            self.directory.mkdir(parents=True, exist_ok=True)
            path = self.directory / 'timing.jsonl'
            payload = ''.join(json.dumps(event, ensure_ascii=False) + '\n' for event in self.events)
            if path.exists() and path.stat().st_size + len(payload.encode()) > self.max_bytes:
                path.replace(path.with_suffix('.previous.jsonl'))
            with path.open('a', encoding='utf-8') as output:
                output.write(payload)
            self.events.clear()
            temporary = self.directory / 'timing-summary.tmp'
            temporary.write_text(json.dumps({'groups': list(self.summary.values()), 'dropped_events': self.dropped,
                'observation_scope': 'LangChain invocations; SDK-internal HTTP retries are not separate attempts'}), encoding='utf-8')
            temporary.replace(self.directory / 'timing-summary.json')
            self.last_flush = time.monotonic()

    def close(self):
        if self.closed:
            return
        self.closed = True
        for key in list(self.pending):
            self._finish(key, 'interrupted')
        self.flush(force=True)
