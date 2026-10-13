"""Repeatable timing-on/off comparison using a local graph, tool and fake model."""
import gc
import json
import os
import time
import tempfile
from decimal import Decimal
from pathlib import Path
from typing import TypedDict
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatResult, ChatGeneration
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END
from stockdepth.api.timing import TimingRecorder, CURRENT_TIMING
from stockdepth.api.usage import UsageRecorder, read_usage
from stockdepth.api.analysis_runner import write_text


class MockModel(BaseChatModel):
    @property
    def _llm_type(self): return 'stage1-mock'

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        time.sleep(.002)
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content='mock', usage_metadata={
            'input_tokens': 10, 'output_tokens': 2, 'total_tokens': 12, 'input_token_details': {'cache_read': 2}}))])


@tool
def mock_tool(query: str) -> str:
    """Return local fixture data without any network request."""
    time.sleep(.001)
    return 'fixture'


class State(TypedDict):
    result: str


def trial(enabled, iterations=30):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        usage = UsageRecorder(root/'usage.json')
        timing = TimingRecorder(root) if enabled else None
        callbacks = [usage] + ([timing] if timing else [])
        model = MockModel(callbacks=callbacks).with_config(metadata={'model_role': 'quick', 'model_config_id': 12,
            'model_provider': 'qwen', 'model_name': 'mock', 'pricing_snapshot': {'input': '1', 'cache': '0', 'output': '2'}})
        def analyst(state):
            mock_tool.invoke({'query': 'fixture'})
            return {'result': model.invoke('mock-input').content}
        builder = StateGraph(State)
        builder.add_node('Market Analyst', analyst)
        builder.set_entry_point('Market Analyst')
        builder.add_edge('Market Analyst', END)
        graph = builder.compile()
        graph.invoke({'result': ''}, config={'callbacks': callbacks})
        usage.calls.clear()
        if timing:
            timing.events.clear()
            timing.summary.clear()
        token = CURRENT_TIMING.set(timing)
        gc.collect()
        cpu_start, wall_start = time.process_time(), time.perf_counter()
        try:
            for _ in range(iterations):
                graph.invoke({'result': ''}, config={'callbacks': callbacks})
                write_text(root/'fixture-report.md', 'x'*100_000)
                if timing:
                    timing.flush()
            if timing:
                timing.close()
        finally:
            CURRENT_TIMING.reset(token)
        elapsed = (time.perf_counter()-wall_start)*1000
        cpu = (time.process_time()-cpu_start)*1000
        calls = read_usage(root/'usage.json')['calls']
        assert len(calls) == iterations
        assert (root/'fixture-report.md').stat().st_size == 100_000
        estimated = sum(Decimal(call['estimated_cost']) for call in calls)
        assert estimated == Decimal('0.000360000000')
        event_count = 0
        if timing:
            groups = json.loads((root/'timing-summary.json').read_text())['groups']
            event_count = sum(group['count'] for group in groups)
            assert event_count == iterations*4
        return {'enabled': enabled, 'iterations': iterations, 'wall_ms': elapsed, 'cpu_ms': cpu,
            'calls': len(calls), 'total_tokens': sum(call['total_tokens'] for call in calls), 'estimated_cost': str(estimated),
            'timing_events': event_count, 'timing_file_bytes': sum(path.stat().st_size for path in root.glob('timing*'))}


results = []
for round_number in range(1, 4):
    for enabled in ([False, True] if round_number % 2 else [True, False]):
        result = {'round': round_number, **trial(enabled)}
        results.append(result)
        print(json.dumps(result))
output = Path(os.environ.get('STAGE1_TIMING_OUTPUT', 'var/performance/stage1-implementation/timing-comparison.json'))
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({'scope': '30 mock node/tool/model/report writes; not real-provider latency or costs', 'results': results}, indent=2))
