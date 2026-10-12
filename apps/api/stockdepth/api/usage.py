"""Persist model-call metadata without prompts, responses or credentials."""
import datetime as dt
import json
import os
from stockdepth.api.costs import cached_tokens, estimate_cost
import threading
from pathlib import Path
from langchain_core.callbacks import BaseCallbackHandler


class UsageRecorder(BaseCallbackHandler):
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()
        self.prices = json.loads(os.environ.get("STOCKDEPTH_MODEL_PRICES", "{}"))
        previous = read_usage(path) if path.exists() else {}
        self.calls = previous.get('calls', [])
        self.history_complete = previous.get('history_complete', not (path.parent / 'reports/progress.json').exists())
        # A previous process may have died with requests in flight.
        for call in self.calls:
            if call['status'] == 'running':
                call['status'] = 'interrupted'
        self._save()

    def _save(self):
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps({'calls': self.calls, 'history_complete': self.history_complete}), encoding='utf-8')
        temporary.replace(self.path)

    def on_chat_model_start(self, serialized, messages, *, run_id, metadata=None, **kwargs):
        with self.lock:
            params = kwargs.get('invocation_params') or {}
            self.calls.append({
                'call_id': str(run_id),
                'agent': (metadata or {}).get('langgraph_node', 'Model'),
                'model': params.get('model') or params.get('model_name') or (metadata or {}).get('ls_model_name', 'unknown'),
                'started_at': dt.datetime.now(dt.timezone.utc).isoformat(),
                'ended_at': None, 'status': 'running',
                'input_tokens': None, 'output_tokens': None, 'total_tokens': None,
                'usage_available': False,
                'is_retry': bool((metadata or {}).get('fallback_retry')),
                'request_kind': (metadata or {}).get('request_kind', 'standard'),
            })
            call = self.calls[-1]
            call.update(pricing_snapshot=self.prices.get(call['model']), cached_input_tokens=None, raw_usage=None, estimated_cost=None, cost_complete=False)
            self._save()

    def _finish(self, run_id, status, usage=None, raw_usage=None):
        with self.lock:
            call = next((c for c in self.calls if c['call_id'] == str(run_id)), None)
            if call is None:
                return
            call['ended_at'] = dt.datetime.now(dt.timezone.utc).isoformat()
            call['status'] = status
            if usage:
                inp = usage.get('input_tokens', usage.get('prompt_tokens'))
                out = usage.get('output_tokens', usage.get('completion_tokens'))
                total = usage.get('total_tokens')
                valid = lambda value: isinstance(value, int) and not isinstance(value, bool) and value >= 0
                if valid(inp) and valid(out):
                    call.update(input_tokens=inp, output_tokens=out,
                                total_tokens=total if valid(total) else inp + out,
                                usage_available=True)
            native = raw_usage or usage or {}
            call['raw_usage'] = native or None
            call['cached_input_tokens'] = cached_tokens(native)
            if call['cached_input_tokens'] is None and usage:
                call['cached_input_tokens'] = cached_tokens(usage)
            call.update(estimate_cost(call['input_tokens'], call['output_tokens'], call['cached_input_tokens'], call.get('pricing_snapshot'), native))
            self._save()

    def on_llm_end(self, response, *, run_id, **kwargs):
        usage = None
        raw_usage = None
        for group in response.generations:
            for generation in group:
                message = getattr(generation, 'message', None)
                raw_usage = (getattr(message, 'response_metadata', {}) or {}).get('token_usage') or (getattr(message, 'response_metadata', {}) or {}).get('usage')
                usage = getattr(message, 'usage_metadata', None)
                if not usage:
                    usage = (getattr(message, 'response_metadata', {}) or {}).get('token_usage')
                if usage:
                    break
            if usage:
                break
        usage = usage or (response.llm_output or {}).get('token_usage') or (response.llm_output or {}).get('usage')
        raw_usage = raw_usage or (response.llm_output or {}).get('token_usage') or (response.llm_output or {}).get('usage')
        self._finish(run_id, 'complete', usage, raw_usage)

    def on_llm_error(self, error, *, run_id, **kwargs):
        self._finish(run_id, 'failed')


def read_usage(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'calls': [], 'history_complete': False}
