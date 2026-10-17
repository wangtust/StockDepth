"""Isolated administrator connection probe using the analysis provider factory."""
import json
import os
import sys

from stockdepth.providers.api_key_env import get_api_key_env
from stockdepth.providers.factory import create_llm_client


def probe(config):
    provider = config['provider']
    key = config['apiKey']
    env_name = get_api_key_env(provider)
    if env_name:
        os.environ[env_name] = key
    base_url = config.get('baseUrl', '').strip()
    if base_url.rstrip('/').endswith(('/chat/completions', '/responses')):
        return {'error': 'Base URL must be the API root, such as https://api.example.com/v1, without /chat/completions or /responses.'}
    if provider == 'azure' and base_url:
        os.environ['AZURE_OPENAI_ENDPOINT'] = base_url
    try:
        llm = create_llm_client(provider, config['modelName'], base_url or None,
                                api_key=key, timeout=25, max_retries=0).get_llm()
        # Reasoning models may need more than a tiny completion budget.
        if hasattr(llm, 'max_tokens'):
            llm.max_tokens = 256
        elif hasattr(llm, 'max_output_tokens'):
            llm.max_output_tokens = 256
        response = llm.invoke([('user', 'Reply with OK only.')])
        if not response.content:
            return {'error': 'The service returned no content. Check the model configuration or output limits.'}
        return {'success': True}
    except Exception as exc:
        from stockdepth.api.usage import is_quota_exhausted
        if is_quota_exhausted(exc):
            return {'error': 'Insufficient quota. Add funds or enable paid usage, then try again.'}
        status = getattr(exc, 'status_code', None)
        messages = {
            400: 'The model service rejected the request. Check the model name, provider, and API protocol.',
            401: 'Authentication failed. Check the API key.',
            403: 'Access denied. Check model permissions, account status, and quota.',
            404: 'The endpoint or model was not found. Check the base URL and model name.',
            429: 'The model service is rate limited or has insufficient quota. Check the account quota and try again.',
        }
        if status in messages:
            return {'error': f'HTTP {status}: {messages[status]}'}
        if status:
            return {'error': f'The model service returned HTTP {status}. Try again later.'}
        return {'error': 'The model test failed due to a timeout, unreachable network, or incompatible configuration. Check the API settings.'}


if __name__ == '__main__':
    config = json.load(sys.stdin)
    result = probe(config)
    print('STOCKDEPTH_PROBE_RESULT=' + json.dumps(result, ensure_ascii=False))
