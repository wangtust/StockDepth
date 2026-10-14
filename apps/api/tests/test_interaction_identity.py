from uuid import uuid4

from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, LLMResult

from stockdepth.api.analysis_runner import save_progress
from stockdepth.api.usage import UsageRecorder


def test_known_agent_identity_survives_progress_and_legacy_messages(tmp_path):
    recorder = UsageRecorder(tmp_path / 'usage.json')
    run_id = uuid4()
    recorder.on_chat_model_start({}, [], run_id=run_id,
                                metadata={'langgraph_node': 'Market Analyst', 'model_name': 'mock-model'})
    message = AIMessage(content='Public response', id='response1')
    recorder.on_llm_end(LLMResult(generations=[[ChatGeneration(message=message)]]), run_id=run_id)
    assert message.response_metadata['stockdepth_interaction'] == {
        'agent': 'Market Analyst', 'model': 'mock-model'}
    reports = tmp_path / 'reports'
    reports.mkdir()
    save_progress({'messages': [message]}, reports)
    text = (reports / 'progress.md').read_text()
    assert 'stockdepth-interaction' in text
    assert 'Market Analyst' in text and 'mock-model' in text
    save_progress({'messages': [AIMessage(content='Legacy response', id='legacy')]}, reports)
    assert 'Legacy response' in (reports / 'progress.md').read_text()


def test_unattributed_call_does_not_invent_an_agent(tmp_path):
    recorder = UsageRecorder(tmp_path / 'usage.json')
    run_id = uuid4()
    recorder.on_chat_model_start({}, [], run_id=run_id, metadata={'model_name': 'mock-model'})
    message = AIMessage(content='Public response', id='response1')
    recorder.on_llm_end(LLMResult(generations=[[ChatGeneration(message=message)]]), run_id=run_id)
    assert 'stockdepth_interaction' not in message.response_metadata
