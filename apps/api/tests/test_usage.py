import json
import tempfile
import unittest
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
