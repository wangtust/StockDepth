import unittest
from types import SimpleNamespace
from unittest.mock import patch

from stockdepth.api.model_probe import probe


class ModelProbeTests(unittest.TestCase):
    def setUp(self):
        self.config = dict(provider='openai-compatible', modelName='fixture',
                           baseUrl='https://example.invalid/v1', apiKey='secret-fixture')

    @patch('stockdepth.api.model_probe.create_llm_client')
    def test_success_uses_analysis_factory(self, factory):
        llm = factory.return_value.get_llm.return_value
        llm.invoke.return_value = SimpleNamespace(content='OK')
        self.assertTrue(probe(self.config)['success'])
        self.assertEqual(factory.call_args.kwargs['max_retries'], 0)
        self.assertEqual(factory.call_args.kwargs['timeout'], 25)

    @patch('stockdepth.api.model_probe.create_llm_client')
    def test_full_endpoint_rejected_before_network(self, factory):
        self.config['baseUrl'] += '/chat/completions'
        self.assertIn('Base URL', probe(self.config)['error'])
        factory.assert_not_called()

    @patch('stockdepth.api.model_probe.create_llm_client')
    def test_empty_output_rejected(self, factory):
        factory.return_value.get_llm.return_value.invoke.return_value = SimpleNamespace(content='')
        self.assertIn('有效内容', probe(self.config)['error'])

    @patch('stockdepth.api.model_probe.create_llm_client')
    def test_errors_never_expose_secret(self, factory):
        for status in (400, 401, 403, 404, 429, 500, None):
            error = RuntimeError(self.config['apiKey'])
            error.status_code = status
            factory.return_value.get_llm.side_effect = error
            result = probe(self.config)
            self.assertIn('error', result)
            self.assertNotIn(self.config['apiKey'], result['error'])


if __name__ == '__main__':
    unittest.main()
