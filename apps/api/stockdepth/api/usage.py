"""Persist model-call metadata without prompts, responses or credentials."""
import datetime as dt
import json
import os
from stockdepth.api.costs import cached_tokens, estimate_cost
import threading
import re
from pathlib import Path
from langchain_core.callbacks import BaseCallbackHandler


class UsageRecorder(BaseCallbackHandler):
    def __init__(self, path: Path, job_id=None):
        self.path = path
        self.lock = threading.RLock()
        self.prices = json.loads(os.environ.get("STOCKDEPTH_MODEL_PRICES", "{}"))
        self.job_id = job_id
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
            if any(call['call_id'] == str(run_id) for call in self.calls):
                return  # Constructor and inherited callbacks can share a handler.
            params = kwargs.get('invocation_params') or {}
            metadata = metadata or {}
            model = params.get('model') or params.get('model_name') or metadata.get('model_name') or metadata.get('ls_model_name', 'unknown')
            prices = metadata.get('pricing_snapshot') or self.prices.get(model)
            self.calls.append({
                'call_id': str(run_id),
                'job_id': self.job_id,
                'agent': metadata.get('langgraph_node', 'Model'),
                'role': metadata.get('model_role', 'legacy'),
                'model_config_id': metadata.get('model_config_id'),
                'provider': metadata.get('model_provider'),
                'model': model,
                'started_at': dt.datetime.now(dt.timezone.utc).isoformat(),
                'ended_at': None, 'status': 'running',
                'input_tokens': None, 'output_tokens': None, 'total_tokens': None,
                'usage_available': False,
                'is_retry': bool((metadata or {}).get('fallback_retry')),
                'request_kind': (metadata or {}).get('request_kind', 'standard'),
            })
            call = self.calls[-1]
            call.update(pricing_snapshot=prices, cached_input_tokens=None, raw_usage=None, estimated_cost=None, cost_complete=False)
            self._save()

    def _finish(self, run_id, status, usage=None, raw_usage=None, failure_reason=None):
        with self.lock:
            call = next((c for c in self.calls if c['call_id'] == str(run_id)), None)
            if call is None:
                return
            call['ended_at'] = dt.datetime.now(dt.timezone.utc).isoformat()
            call['status'] = status
            if failure_reason:
                call['failure_reason'] = failure_reason
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
        # Attach only known public identity to the returned message. It survives
        # Checkpoint serialization and does not alter token/cost accounting.
        with self.lock:
            identity = next((c for c in self.calls if c['call_id'] == str(run_id)), None)
            public_identity = ({'agent': identity['agent'], 'model': identity['model']}
                               if identity and identity['agent'] != 'Model' else None)
        if public_identity:
            for group in response.generations:
                for generation in group:
                    message = getattr(generation, 'message', None)
                    if message is not None and hasattr(message, 'response_metadata'):
                        message.response_metadata = {**(message.response_metadata or {}),
                                                     'stockdepth_interaction': public_identity}
        usage = None
        raw_usage = None
        for group in response.generations:
            for generation in group:
                message = getattr(generation, 'message', None)
                metadata_usage = getattr(message, 'response_metadata', {}) or {}
                raw_usage = (metadata_usage.get('token_usage') or metadata_usage.get('usage') or
                             metadata_usage.get('usage_metadata') or metadata_usage.get('usageMetadata'))
                usage = getattr(message, 'usage_metadata', None)
                if not usage:
                    usage = (metadata_usage.get('token_usage') or metadata_usage.get('usage') or
                             metadata_usage.get('usage_metadata') or metadata_usage.get('usageMetadata'))
                if usage:
                    break
            if usage:
                break
        usage = usage or (response.llm_output or {}).get('token_usage') or (response.llm_output or {}).get('usage') or (response.llm_output or {}).get('usage_metadata') or (response.llm_output or {}).get('usageMetadata')
        raw_usage = raw_usage or (response.llm_output or {}).get('token_usage') or (response.llm_output or {}).get('usage') or (response.llm_output or {}).get('usage_metadata') or (response.llm_output or {}).get('usageMetadata')
        if raw_usage and 'input_tokens' in raw_usage and any(k in raw_usage for k in ('cache_read_input_tokens', 'cache_creation_input_tokens')):
            usage = {**(usage or {}),
                     'input_tokens': raw_usage.get('input_tokens', 0) + raw_usage.get('cache_read_input_tokens', 0) + raw_usage.get('cache_creation_input_tokens', 0),
                     'output_tokens': raw_usage.get('output_tokens', (usage or {}).get('output_tokens'))}
        if usage and 'input_tokens' not in usage and 'prompt_tokens' not in usage:
            usage = {**usage, 'input_tokens': usage.get('promptTokenCount'),
                     'output_tokens': usage.get('candidatesTokenCount'),
                     'cached_tokens': usage.get('cachedContentTokenCount')}
        self._finish(run_id, 'complete', usage, raw_usage)

    def on_llm_error(self, error, *, run_id, **kwargs):
        reason = 'quota_exhausted' if is_quota_exhausted(error) else None
        self._finish(run_id, 'failed', failure_reason=reason)


def read_usage(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'calls': [], 'history_complete': False}


def is_quota_exhausted(error):
    return bool(re.search(
        r'insufficient_quota|quota_exhausted|401008|free trial quota.*exhausted|'
        r'insufficient (?:account )?(?:balance|credits)|credit balance.*(?:too low|insufficient)|'
        r'(?:余额|额度|配额).{0,12}(?:不足|耗尽|用尽)|billing_hard_limit_reached',
        str(error), re.IGNORECASE))
