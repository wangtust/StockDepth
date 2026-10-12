import unittest
from unittest.mock import patch

from stockdepth.providers.factory import create_llm_client


class CompatibleTimeoutTest(unittest.TestCase):
    def test_default_and_explicit_timeout(self):
        with patch.dict('os.environ', OPENAI_API_KEY='test-placeholder'):
            client = create_llm_client('openai-compatible', 'hy4-preview', 'https://example.invalid/v1').get_llm()
            self.assertEqual(client.root_client.timeout, 600)
            self.assertEqual(client.root_client.max_retries, 1)
            custom = create_llm_client('openai-compatible', 'hy4-preview', 'https://example.invalid/v1', timeout=45, max_retries=0).get_llm()
            self.assertEqual(custom.root_client.timeout, 45)
            self.assertEqual(custom.root_client.max_retries, 0)
