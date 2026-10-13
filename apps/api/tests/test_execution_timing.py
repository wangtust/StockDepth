import json
import tempfile
import time
from pathlib import Path
from typing import TypedDict
from unittest.mock import patch

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END
from stockdepth.api.timing import TimingRecorder, CURRENT_TIMING
from stockdepth.api.usage import UsageRecorder, read_usage
from stockdepth.api.analysis_runner import write_text


def test_graph_agent_tool_model_and_direct_model_are_measured_once():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        recorder = TimingRecorder(root, job_id=42)
        usage = UsageRecorder(root / 'usage.json', job_id=42)

        class FakeModel(BaseChatModel):
            @property
            def _llm_type(self): return 'mock'

            def _generate(self, messages, stop=None, run_manager=None, **kwargs):
                time.sleep(.005)
                return ChatResult(generations=[ChatGeneration(message=AIMessage(content='mock-result',
                    usage_metadata={'input_tokens': 2, 'output_tokens': 1, 'total_tokens': 3}))])

        model = FakeModel(callbacks=[recorder, usage]).with_config(metadata={
            'model_role': 'quick', 'model_config_id': 12, 'model_provider': 'qwen', 'model_name': 'mock-model',
        })

        @tool
        def mock_data(query: str) -> str:
            """Return only local fixture data."""
            time.sleep(.002)
            return 'mock-data-result'

        class State(TypedDict):
            result: str

        def analyst(state):
            mock_data.invoke({'query': 'private-tool-argument'})
            return {'result': model.invoke('private-prompt').content}

        graph = StateGraph(State)
        graph.add_node('Market Analyst', analyst)
        graph.set_entry_point('Market Analyst')
        graph.add_edge('Market Analyst', END)
        graph.compile().invoke({'result': ''}, config={'callbacks': [recorder, usage]})
        model.invoke('private-direct-prompt')  # Covers final signal processing outside LangGraph.
        token = CURRENT_TIMING.set(recorder)
        try:
            write_text(root / 'report.md', 'private-report-body')
        finally:
            CURRENT_TIMING.reset(token)
        recorder.close()
        recorder.close()
        groups = json.loads((root / 'timing-summary.json').read_text())['groups']
        counts = {kind: sum(group['count'] for group in groups if group['kind'] == kind)
                  for kind in ('agent', 'model', 'tool', 'report_write')}
        assert counts == {'agent': 1, 'model': 2, 'tool': 1, 'report_write': 1}
        assert len(read_usage(root / 'usage.json')['calls']) == 2
        assert all(group['total_ms'] > 0 for group in groups)
        body = (root / 'timing.jsonl').read_text()
        for secret in ('private-prompt', 'private-tool-argument', 'private-report-body', 'mock-result'):
            assert secret not in body


def test_timing_buffer_is_bounded_and_telemetry_failure_is_nonfatal():
    with tempfile.TemporaryDirectory() as directory:
        recorder = TimingRecorder(Path(directory), max_events=2)
        for _ in range(5):
            with recorder.measure('tool', 'mock'):
                pass
        assert len(recorder.events) == 2
        assert recorder.dropped == 3
        with patch.object(Path, 'open', side_effect=OSError('disk full; private-value')):
            recorder.flush(force=True)
        assert not recorder.events


def test_failure_and_interrupted_spans_never_store_exception_details():
    with tempfile.TemporaryDirectory() as directory:
        recorder = TimingRecorder(Path(directory))
        recorder.on_tool_start({'name': 'mock'}, 'private-input', run_id='tool')
        recorder.on_tool_error(RuntimeError('private-error-secret'), run_id='tool')
        recorder.on_chat_model_start({}, [], run_id='model')
        recorder.close()
        events = [json.loads(line) for line in (Path(directory)/'timing.jsonl').read_text().splitlines()]
        assert [event['status'] for event in events] == ['failed', 'interrupted']
        assert 'private' not in json.dumps(events)
