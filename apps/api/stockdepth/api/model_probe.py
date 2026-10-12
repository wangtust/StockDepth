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
        return {'error': 'Base URL 应填写接口根地址，例如 https://tokenhub.tencentmaas.com/v1，不要包含 /chat/completions 或 /responses。'}
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
            return {'error': '接口未返回有效内容，请检查模型配置或输出限制。'}
        return {'success': True}
    except Exception as exc:
        status = getattr(exc, 'status_code', None)
        messages = {
            400: '请求被模型服务拒绝，请检查模型名称、Provider 和接口协议。',
            401: '认证失败，请检查 API Key。',
            403: '访问被拒绝，请检查模型权限、账户状态或额度。',
            404: '接口或模型不存在，请检查 Base URL 和模型名称。',
            429: '模型服务限流或额度不足，请检查账户额度后重试。',
        }
        if status in messages:
            return {'error': f'HTTP {status}：{messages[status]}'}
        if status:
            return {'error': f'模型服务返回 HTTP {status}，请稍后重试。'}
        return {'error': '模型测试失败：连接超时、网络不可达或配置不兼容，请检查接口配置。'}


if __name__ == '__main__':
    config = json.load(sys.stdin)
    result = probe(config)
    print('STOCKDEPTH_PROBE_RESULT=' + json.dumps(result, ensure_ascii=False))
