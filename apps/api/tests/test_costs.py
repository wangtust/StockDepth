import unittest
import tempfile
import os
import json
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, LLMResult
from stockdepth.api.costs import estimate_cost, cached_tokens
from stockdepth.api.usage import UsageRecorder, read_usage

PRICES = {'input': '1', 'cache': '0.25', 'output': '4'}

class CostTests(unittest.TestCase):
    def test_no_double_counting_cache(self):
        cost = estimate_cost(1_000_000, 100_000, 400_000, PRICES)
        self.assertEqual(cost, {'estimated_cost': '1.100000000000', 'cost_complete': True})

    def test_unknown_cache_is_upper_estimate(self):
        self.assertEqual(estimate_cost(1_000_000, 100_000, None, PRICES),
                         {'estimated_cost': '1.400000000000', 'cost_complete': False})

    def test_missing_prices_usage_or_invalid_cache(self):
        for args in [(10, 5, 0, None), (None, None, None, PRICES), (10, 5, 11, PRICES)]:
            self.assertIsNone(estimate_cost(*args)['estimated_cost'])
        self.assertIsNone(estimate_cost(10, 5, 0, PRICES, {'cache_creation_input_tokens': 2})['estimated_cost'])

    def test_free_price_is_different_from_unknown(self):
        self.assertEqual(estimate_cost(10, 5, None, {'input':'0','cache':'0','output':'0'}),
                         {'estimated_cost': '0.000000000000', 'cost_complete': True})

    def test_cache_field_variants(self):
        for value in [{'prompt_cache_hit_tokens': 0}, {'cache_read_input_tokens': 0},
                      {'prompt_tokens_details': {'cached_tokens': 0}}, {'input_token_details': {'cache_read': 0}}]:
            self.assertEqual(cached_tokens(value), 0)
        self.assertIsNone(cached_tokens({}))

    def test_native_usage_and_price_snapshot_survive_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'usage.json'
            with patch.dict(os.environ, {'STOCKDEPTH_MODEL_PRICES': json.dumps({'test': PRICES})}):
                recorder = UsageRecorder(file)
                run_id = uuid4()
                recorder.on_chat_model_start({}, [], run_id=run_id, invocation_params={'model':'test'})
                response = LLMResult(generations=[[ChatGeneration(message=AIMessage(content='ok',
                    usage_metadata={'input_tokens':1000,'output_tokens':100,'total_tokens':1100},
                    response_metadata={'token_usage': {'prompt_tokens':1000,'completion_tokens':100,'prompt_tokens_details':{'cached_tokens':400}}}))]])
                recorder.on_llm_end(response, run_id=run_id)
            with patch.dict(os.environ, {'STOCKDEPTH_MODEL_PRICES': '{}'}):
                UsageRecorder(file)
            call = read_usage(file)['calls'][0]
            self.assertEqual(call['estimated_cost'], '0.001100000000')
            self.assertEqual(call['cached_input_tokens'], 400)
            self.assertEqual(call['pricing_snapshot'], PRICES)
            self.assertTrue(call['cost_complete'])
            self.assertIn('prompt_tokens_details', call['raw_usage'])
