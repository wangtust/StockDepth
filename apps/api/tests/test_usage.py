import json
import tempfile
import unittest
import pytest
from unittest.mock import Mock, patch
from pydantic import BaseModel
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.outputs import ChatResult
from stockdepth.agents.utils.structured import bind_structured, invoke_structured_or_freetext
from stockdepth.workflows.trading_graph import StockDepthGraph
from pathlib import Path
from uuid import uuid4
from langchain_core.messages import AIMessage
from langchain_core.outputs import LLMResult, ChatGeneration
from stockdepth.api.usage import UsageRecorder, read_usage


class UsageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'usage.json'
        self.recorder = UsageRecorder(self.path)

    def start(self, run_id):
        self.recorder.on_chat_model_start({}, [], run_id=run_id,
            metadata={'langgraph_node': 'Research Manager'}, invocation_params={'model': 'test-model'})

    def test_version_reference_survives_resume_without_backfilling_legacy_calls(self):
        legacy, versioned = uuid4(), uuid4()
        self.start(legacy)
        self.recorder.on_chat_model_start({}, [], run_id=versioned,
            metadata={'model_role': 'quick', 'model_config_id': 7, 'model_version_id': 71},
            invocation_params={'model': 'test-model'})
        resumed = UsageRecorder(self.path)
        calls = {call['call_id']: call for call in resumed.calls}
        self.assertIsNone(calls[str(legacy)].get('model_version_id'))
        self.assertEqual(calls[str(versioned)]['model_version_id'], 71)
        self.assertEqual(calls[str(versioned)]['model_config_id'], 7)

    def test_usage_and_duplicate_completion(self):
        run_id = uuid4()
        self.start(run_id)
        response = LLMResult(generations=[[ChatGeneration(message=AIMessage(content='ok',
            usage_metadata={'input_tokens': 12, 'output_tokens': 3, 'total_tokens': 15}))]])
        self.recorder.on_llm_end(response, run_id=run_id)
        self.recorder.on_llm_end(response, run_id=run_id)
        calls = read_usage(self.path)['calls']
        self.assertEqual(len(calls), 1)
        self.assertTrue(read_usage(self.path)['history_complete'])
        self.assertEqual(calls[0]['total_tokens'], 15)
        self.assertEqual(calls[0]['agent'], 'Research Manager')
        self.assertTrue(calls[0]['usage_available'])

    def test_missing_usage_failure_and_resume(self):
        first, second, third = uuid4(), uuid4(), uuid4()
        self.start(first)
        self.recorder.on_llm_end(LLMResult(generations=[[ChatGeneration(message=AIMessage(content='ok'))]]), run_id=first)
        self.start(second)
        self.recorder.on_llm_error(RuntimeError('secret must not persist'), run_id=second)
        self.start(third)
        resumed = UsageRecorder(self.path)
        self.assertEqual([x['status'] for x in resumed.calls], ['complete', 'failed', 'interrupted'])
        self.assertTrue(all(not x['usage_available'] for x in resumed.calls))
        self.assertNotIn('secret', self.path.read_text())

    def test_provider_response_metadata(self):
        run_id = uuid4()
        self.start(run_id)
        response = LLMResult(generations=[[ChatGeneration(message=AIMessage(content='ok',
            response_metadata={'token_usage': {'prompt_tokens': 4, 'completion_tokens': 2}}))]])
        self.recorder.on_llm_end(response, run_id=run_id)
        self.assertEqual(read_usage(self.path)['calls'][0]['total_tokens'], 6)

    def test_role_identity_and_immutable_price_snapshot(self):
        run_id = uuid4()
        self.recorder.on_chat_model_start({}, [], run_id=run_id, metadata={
            'langgraph_node': 'Market Analyst', 'model_role': 'quick',
            'model_config_id': 12, 'model_provider': 'qwen', 'model_name': 'shared-name',
            'pricing_snapshot': {'currency': 'CNY', 'input': '2', 'cache': '0.5', 'output': '8'},
        }, invocation_params={'model': 'shared-name'})
        response = LLMResult(generations=[[ChatGeneration(message=AIMessage(content='ok',
            usage_metadata={'input_tokens': 100, 'output_tokens': 10, 'total_tokens': 110,
                            'input_token_details': {'cache_read': 25}}))]])
        self.recorder.on_llm_end(response, run_id=run_id)
        call = read_usage(self.path)['calls'][0]
        self.assertEqual((call['role'], call['model_config_id'], call['provider']), ('quick', 12, 'qwen'))
        self.assertEqual(call['agent'], 'Market Analyst')
        self.assertEqual(call['cached_input_tokens'], 25)
        self.assertEqual(call['estimated_cost'], '0.000242500000')
        self.assertTrue(call['cost_complete'])
        self.assertNotIn('api_key', json.dumps(call))

    def test_anthropic_cache_write_usage_is_counted_but_cost_is_incomplete(self):
        run_id = uuid4()
        self.recorder.on_chat_model_start({}, [], run_id=run_id, metadata={
            'model_role': 'deep', 'model_config_id': 25, 'model_provider': 'anthropic',
            'pricing_snapshot': {'currency': 'CNY', 'input': '3', 'cache': '1', 'output': '10'},
        }, invocation_params={'model': 'claude-test'})
        message = AIMessage(content='ok', usage_metadata={'input_tokens': 9, 'output_tokens': 2, 'total_tokens': 11},
            response_metadata={'usage': {'input_tokens': 4, 'cache_read_input_tokens': 2,
                                         'cache_creation_input_tokens': 3, 'output_tokens': 2}})
        self.recorder.on_llm_end(LLMResult(generations=[[ChatGeneration(message=message)]]), run_id=run_id)
        call = read_usage(self.path)['calls'][0]
        self.assertEqual(call['input_tokens'], 9)
        self.assertEqual(call['cached_input_tokens'], 2)
        self.assertIsNone(call['estimated_cost'])
        self.assertFalse(call['cost_complete'])

    def test_google_usage_metadata_maps_vendor_token_fields(self):
        run_id = uuid4()
        self.recorder.on_chat_model_start({}, [], run_id=run_id, metadata={
            'model_role': 'quick', 'model_config_id': 4, 'model_provider': 'google',
            'pricing_snapshot': {'input': '1', 'cache': '0.2', 'output': '4'},
        }, invocation_params={'model': 'gemini-test'})
        message = AIMessage(content='ok', response_metadata={'usageMetadata': {
            'promptTokenCount': 20, 'candidatesTokenCount': 5, 'cachedContentTokenCount': 8,
        }})
        self.recorder.on_llm_end(LLMResult(generations=[[ChatGeneration(message=message)]]), run_id=run_id)
        call = read_usage(self.path)['calls'][0]
        self.assertEqual((call['input_tokens'], call['output_tokens'], call['cached_input_tokens']), (20, 5, 8))
        self.assertEqual(call['estimated_cost'], '0.000033600000')
        self.assertTrue(call['cost_complete'])

    def test_graph_callback_propagation_and_fallback_metadata(self):
        from typing import TypedDict
        from langchain_core.language_models.chat_models import BaseChatModel
        from langchain_core.outputs import ChatResult
        from langgraph.graph import StateGraph, END
        recorder = self.recorder

        class FakeModel(BaseChatModel):
            @property
            def _llm_type(self):
                return 'test'

            def _generate(self, messages, stop=None, run_manager=None, **kwargs):
                return ChatResult(generations=[ChatGeneration(message=AIMessage(content='ok',
                    usage_metadata={'input_tokens': 2, 'output_tokens': 1, 'total_tokens': 3}))])

        class State(TypedDict):
            result: str

        def agent(state):
            model = FakeModel()
            model.invoke('structured', config={'metadata': {'request_kind': 'structured'}})
            result = model.invoke('fallback', config={'metadata': {'request_kind': 'free-text', 'fallback_retry': True}})
            return {'result': result.content}

        graph = StateGraph(State)
        graph.add_node('Research Manager', agent)
        graph.set_entry_point('Research Manager')
        graph.add_edge('Research Manager', END)
        graph.compile().invoke({'result': ''}, config={'callbacks': [recorder]})
        calls = read_usage(self.path)['calls']
        self.assertEqual(len(calls), 2)
        self.assertTrue(all(c['agent'] == 'Research Manager' for c in calls))
        self.assertEqual(sum(c['total_tokens'] for c in calls), 6)
        self.assertTrue(calls[1]['is_retry'])

    def test_legacy_resume_has_incomplete_history(self):
        legacy = Path(self.directory.name) / 'legacy'
        (legacy / 'reports').mkdir(parents=True)
        (legacy / 'reports/progress.json').write_text('{}')
        recorder = UsageRecorder(legacy / 'usage.json')
        self.assertFalse(recorder.history_complete)


# Exercise the real LangChain binding/parser/callback machinery, with no HTTP.


class UsageAnswer(BaseModel):
    value: int


class UsageMockModel(BaseChatModel):
    mode: str = 'success'

    @property
    def _llm_type(self):
        return 'usage-mock'

    def bind_tools(self, tools, *, tool_choice=None, **kwargs):
        return self.bind(tools=tools, **kwargs)

    def with_structured_output(self, schema, **kwargs):
        if self.mode == 'unsupported':
            raise NotImplementedError('mock unsupported')
        return super().with_structured_output(schema, **kwargs)

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        tools = kwargs.get('tools')
        if tools and self.mode == 'request_failure':
            raise RuntimeError('mock provider failure')
        calls = ([{'name': 'UsageAnswer', 'args': {'value':
                  'invalid' if self.mode == 'parse_failure' else 1}, 'id': 'mock-tool'}]
                 if tools else [])
        return ChatResult(generations=[ChatGeneration(message=AIMessage(
            content='ok', tool_calls=calls,
            usage_metadata={'input_tokens': 100, 'output_tokens': 10, 'total_tokens': 110,
                            'input_token_details': {'cache_read': 25}}))])


class MetadataUsageRecorder(UsageRecorder):
    def __init__(self, path):
        self.received_metadata = []
        super().__init__(path)

    def on_chat_model_start(self, serialized, messages, *, run_id, metadata=None, **kwargs):
        from copy import deepcopy
        self.received_metadata.append(deepcopy(metadata))
        return super().on_chat_model_start(serialized, messages, run_id=run_id,
                                          metadata=metadata, **kwargs)


@pytest.mark.parametrize('path', ['plain', 'tools', 'structured', 'parse_failure',
                                 'request_failure', 'unsupported'])
def test_role_identity_survives_all_bindings_and_fallbacks(tmp_path, path):
    recorder = MetadataUsageRecorder(tmp_path / 'usage.json')
    graph = StockDepthGraph.__new__(StockDepthGraph)
    graph.config = {}
    graph.callbacks = [recorder]
    expected = []
    for role, config_id, provider, rate, cost in (
        ('quick', 12, 'qwen', '2', '0.000242500000'),
        ('deep', 25, 'openai', '4', '0.000392500000'),
    ):
        prices = {'input': rate, 'cache': '0.5', 'output': '8'}
        config = {'id': config_id, 'provider': provider, 'model': 'shared-name',
                  'api_key': 'mock-secret', 'prices': prices}
        raw = UsageMockModel(callbacks=[recorder], mode=path)
        with patch('stockdepth.workflows.trading_graph.create_llm_client',
                   return_value=Mock(get_llm=Mock(return_value=raw))):
            llm = graph._make_role_llm(role, config)
        invocation = {'metadata': {'langgraph_node': 'Mock Agent'}}
        if path == 'plain':
            llm.invoke('test', config=invocation)
        elif path == 'tools':
            llm.bind_tools([UsageAnswer]).invoke('test', config=invocation)
        else:
            result = invoke_structured_or_freetext(
                bind_structured(llm, UsageAnswer, 'Mock Agent'), llm, 'test',
                lambda answer: str(answer.value), 'Mock Agent')
            assert result == ('1' if path == 'structured' else 'ok')
        count = 2 if path in ('parse_failure', 'request_failure') else 1
        expected.extend([(role, config_id, provider, dict(prices), cost)] * count)
        # Neither the model nor earlier records may reference mutable config prices.
        prices['input'] = '999'
        assert llm.metadata['pricing_snapshot']['input'] == rate

    calls = read_usage(recorder.path)['calls']
    assert len(calls) == len(expected) == len(recorder.received_metadata)
    for index, (call, metadata, identity) in enumerate(zip(calls, recorder.received_metadata, expected)):
        role, config_id, provider, prices, cost = identity
        assert (call['role'], call['model_config_id'], call['provider']) == (role, config_id, provider)
        assert (metadata['model_role'], metadata['model_config_id'], metadata['model_provider']) == (role, config_id, provider)
        assert call['pricing_snapshot'] == metadata['pricing_snapshot'] == prices
        if path in ('plain', 'tools'):
            assert call['agent'] == 'Mock Agent'
        if path in ('parse_failure', 'request_failure'):
            assert call['request_kind'] == ('structured' if index % 2 == 0 else 'free-text')
            assert call['is_retry'] == (index % 2 == 1)
        elif path in ('structured', 'unsupported'):
            assert call['request_kind'] == ('structured' if path == 'structured' else 'free-text')
            assert not call['is_retry']
        if path == 'request_failure' and index % 2 == 0:
            assert call['status'] == 'failed'
            assert call['input_tokens'] is None and call['output_tokens'] is None
            assert call['estimated_cost'] is None and not call['cost_complete']
        else:
            assert call['status'] == 'complete'
            assert (call['input_tokens'], call['output_tokens']) == (100, 10)
            assert call['estimated_cost'] == cost
            assert call['cost_complete']
    assert 'mock-secret' not in recorder.path.read_text()


def test_price_snapshot_does_not_change_after_call_start(tmp_path):
    recorder = UsageRecorder(tmp_path / 'usage.json')
    prices = {'input': '2', 'cache': '0.5', 'output': '8'}
    run_id = uuid4()
    recorder.on_chat_model_start({}, [], run_id=run_id, metadata={
        'model_config_id': 12, 'pricing_snapshot': prices})
    prices['input'] = '999'
    recorder.on_llm_end(LLMResult(generations=[[ChatGeneration(message=AIMessage(
        content='ok', usage_metadata={'input_tokens': 100, 'output_tokens': 10,
                                    'total_tokens': 110,
                                    'input_token_details': {'cache_read': 25}}))]]), run_id=run_id)
    call = read_usage(recorder.path)['calls'][0]
    assert call['pricing_snapshot']['input'] == '2'
    assert call['estimated_cost'] == '0.000242500000'


@pytest.mark.parametrize('config_id', [12, None])
def test_only_legacy_calls_can_use_model_name_prices(tmp_path, config_id):
    recorder = UsageRecorder(tmp_path / 'usage.json')
    recorder.prices = {'shared-name': {'input': '2', 'cache': '0.5', 'output': '8'}}
    recorder.on_chat_model_start({}, [], run_id=uuid4(), metadata={
        'model_config_id': config_id, 'model_name': 'shared-name', 'pricing_snapshot': None})
    call = read_usage(recorder.path)['calls'][0]
    assert call['pricing_snapshot'] == (recorder.prices['shared-name'] if config_id is None else None)
    assert call['estimated_cost'] is None and not call['cost_complete']
