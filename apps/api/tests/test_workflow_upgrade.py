"""Offline acceptance: bounded fan-out, safe results and isolated resumable jobs."""
import json
import multiprocessing
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from uuid import uuid4

import pytest
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.prebuilt import ToolNode

from stockdepth.agents.utils.memory import TradingMemoryLog
from stockdepth.agents.utils.rating import parse_rating
from stockdepth.api.analysis_runner import save_progress
from stockdepth.api.execution_metrics import save_execution_metrics
from stockdepth.api.report_persistence import ReportPersistence
from stockdepth.api.usage import UsageRecorder, read_usage
from stockdepth.providers.request_gate import RequestGate
from stockdepth.workflows.analyst_execution import build_analyst_execution_plan, effective_analyst_concurrency
from stockdepth.workflows.data_guard import guarded_tools
from stockdepth.workflows.execution_config import execution_config
from stockdepth.workflows.parallel_analysts import bounded_analyst, isolated_analyst
from stockdepth.workflows.conditional_logic import ConditionalLogic
from stockdepth.workflows.research_validation import MISSING_REPORT, report_barrier, validate_decision
from .test_stage3_python import MockModel, mock_workflow, initial, local_data


@pytest.mark.parametrize('concurrency', [1, 2, 4])
def test_v2_full_fanout_isolation_join_usage_and_live_progress(tmp_path, concurrency):
    model = MockModel()
    recorder = UsageRecorder(tmp_path / 'usage.json')
    graph = mock_workflow(concurrency, model, workflow_version=2,
                          memory_node=lambda state: {'past_context': 'isolated lesson'}).compile()
    final = {}
    namespaces = set()
    for namespace, chunk in graph.stream(initial(), {'callbacks': [recorder]}, stream_mode='values', subgraphs=True):
        if namespace:
            namespaces.add(namespace)
            save_progress(chunk, tmp_path / 'reports')
        else:
            final.update(chunk)
    assert len(namespaces) == 4
    assert model._peak == concurrency
    assert final['research_status'] == dict.fromkeys(['market', 'news', 'social', 'fundamentals'], 'complete')
    assert final['past_context'] == 'isolated lesson'
    assert final['decision_rating'] == 'REVIEW'  # fixture PM has no explicit rating
    assert len(read_usage(tmp_path / 'usage.json')['calls']) == 8
    assert sum(c['total_tokens'] for c in recorder.calls) == 120
    progress = (tmp_path / 'reports/progress.md').read_text()
    assert all(f'{key}-private-tool-result' in progress for key in final['research_status'])
    for key, contents in model._seen:
        assert all(other + '-private-tool-result' not in contents for other in final['research_status'] if other != key)


@pytest.mark.parametrize('concurrency', [1, 2, 4])
def test_v2_sqlite_resume_does_not_rebill_finished_sibling_or_tool_request(tmp_path, concurrency):
    broken = MockModel()
    broken._fail.add('news')
    config = {'configurable': {'thread_id': 'v2-recovery'}}
    with SqliteSaver.from_conn_string(str(tmp_path / 'checkpoint.db')) as saver:
        with pytest.raises(RuntimeError, match='interruption'):
            mock_workflow(concurrency, broken, workflow_version=2).compile(checkpointer=saver).invoke(initial(), config)
    recovered = MockModel()
    with SqliteSaver.from_conn_string(str(tmp_path / 'checkpoint.db')) as saver:
        result = mock_workflow(concurrency, recovered, workflow_version=2).compile(checkpointer=saver).invoke(None, config)
    assert recovered._calls['market'] == 0
    assert recovered._calls['news'] == 1
    assert result['research_status']['news'] == 'complete'


@pytest.mark.parametrize('budget', [1, 3])
def test_tool_budget_terminates_infinite_model_and_marks_missing_report(budget):
    spec = build_analyst_execution_plan(['market']).specs[0]
    calls = []
    def forever(state):
        calls.append(state)
        return {'messages': [AIMessage(content='', tool_calls=[
            {'name': 'local_data', 'args': {'key': 'market'}, 'id': str(len(calls))}
        ])], spec.report_key: ''}
    agent = bounded_analyst(spec, forever, budget)
    graph = isolated_analyst(spec, agent, ToolNode([local_data]), ConditionalLogic())
    result = graph(initial(), {})
    assert len(calls) == budget + 1
    assert result[spec.report_key].startswith(MISSING_REPORT)
    assert 'budget exhausted' in calls[-1]['messages'][-1].content
    barrier = report_barrier(build_analyst_execution_plan(['market']))(result)
    assert barrier['research_status']['market'] == 'missing'
    assert validate_decision({**result, **barrier, 'final_trade_decision': 'Rating: Buy'})['decision_rating'] == 'REVIEW'


def test_missing_selected_report_is_visible_and_unselected_is_not_required():
    plan = build_analyst_execution_plan(['news', 'market'], 2)
    result = report_barrier(plan)({'news_report': '   ', 'market_report': 'Technical evidence'})
    assert result['news_report'].startswith(MISSING_REPORT)
    assert result['research_status'] == {'news': 'missing', 'market': 'complete'}
    assert 'fundamentals_report' not in result


@pytest.mark.parametrize('text', ['', 'buy thesis rejected; hold until reviewed', 'Rating: unknown\nBuy', 'Rating: Buy\nRating: Sell', 'Rating: REVIEW\nOriginal:\nRating: Buy', 'Rating: BUY/HOLD/SELL', 'Rating: Buy if the price drops'])
def test_ambiguous_or_unrecognized_rating_never_defaults_to_hold(text):
    assert parse_rating(text) == 'REVIEW'


def test_v2_manifest_freezes_shape_on_replacement_and_legacy_resume(tmp_path):
    cfg = {'analyst_concurrency_limit': 4, 'max_tool_rounds': 3}
    saved = execution_config(tmp_path, cfg, ['news', 'market'], owner=12)
    assert saved['workflow_version'] == 2 and saved['analyst_concurrency_limit'] == 4
    assert execution_config(tmp_path, {'analyst_concurrency_limit': 1}, ['news', 'market'], resume=True, owner=12) == saved
    with pytest.raises(ValueError, match='identity'):
        execution_config(tmp_path, cfg, ['news', 'market'], owner=13)
    legacy = tmp_path / 'old'; legacy.mkdir()
    assert execution_config(legacy, cfg, ['market'], resume=True)['workflow_version'] == 1


@pytest.mark.parametrize('capacity,expected', [(1, 1), (2, 2), (3, 2), (4, 4)])
def test_quick_snapshot_bounds_124_concurrency(capacity, expected):
    assert effective_analyst_concurrency({'analyst_concurrency_limit': 4, 'model_configs': {'quick': {'options': {'request_concurrency': capacity}}}}) == expected


def test_memory_isolation_atomic_writes_and_point_in_time(tmp_path):
    config = {'memory_log_path': str(tmp_path / 'memory.md')}
    alice = TradingMemoryLog({**config, 'memory_owner': 'alice'})
    bob = TradingMemoryLog({**config, 'memory_owner': 'bob'})
    alice.store_decision('MOCK', '2020-01-01', 'Rating: Buy')
    alice.update_with_outcome('MOCK', '2020-01-01', .1, .05, 5, 'Private lesson')
    assert not bob.load_entries()
    assert not alice.get_past_context('MOCK', as_of='2020-02-01')  # outcome learned today
    assert 'Private lesson' in alice.get_past_context('MOCK', as_of='9999-01-01')
    assert not alice.get_past_context('MOCK', as_of='2019-01-01')
    def write(n):
        other = TradingMemoryLog({**config, 'memory_owner': 'alice'})
        other.store_decision('MOCK', f'2020-02-{n:02}', 'Rating: Hold')
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(write, range(1, 10)))
    assert len(alice.load_entries()) == 10
    assert not (tmp_path / 'memory.md').exists()


def test_data_guard_rejects_wrong_ticker_and_future_arguments_before_execution():
    state = initial()
    calls = [{'name': 'local_data', 'args': {'key': 'okay'}, 'id': 'valid'},
             {'name': 'get_stock_data', 'args': {'symbol': 'OTHER', 'end_date': '2026-10-14'}, 'id': 'invalid'}]
    state['messages'] = [AIMessage(content='', tool_calls=calls)]
    from langgraph.graph import START, END, StateGraph
    from stockdepth.agents.utils.agent_states import AgentState
    graph = StateGraph(AgentState)
    graph.add_node("guard", guarded_tools(ToolNode([local_data])))
    graph.add_edge(START, "guard"); graph.add_edge("guard", END)
    result = graph.compile().invoke(state)
    result["messages"] = [m for m in result["messages"] if isinstance(m, ToolMessage)]
    assert {m.tool_call_id for m in result['messages']} == {'valid', 'invalid'}
    assert next(m.content for m in result['messages'] if m.tool_call_id == 'invalid').startswith('[DATA QUALITY]')


def test_historical_current_feeds_are_unavailable_before_vendor_call():
    from stockdepth.data import interface
    config = {'workflow_version': 2, 'analysis_date': '2020-01-01'}
    with patch.object(interface, 'get_config', return_value=config):
        with patch.object(interface, 'get_vendor', side_effect=AssertionError('must not call vendor')):
            for method in ['get_fundamentals', 'get_balance_sheet', 'get_insider_transactions']:
                assert '[DATA UNAVAILABLE AS OF 2020-01-01]' in interface.route_to_vendor(method, 'MOCK')


def test_request_gate_shared_between_clients_timeout_and_error_release(tmp_path):
    first = RequestGate('same-config', 1, .05, tmp_path)
    second = RequestGate('same-config', 1, .05, tmp_path)
    identity = uuid4()
    first.on_chat_model_start({}, [], run_id=identity)
    first.on_chat_model_start({}, [], run_id=identity)  # constructor+inherited callbacks
    with pytest.raises(TimeoutError):
        second.on_chat_model_start({}, [], run_id=uuid4())
    first.on_llm_error(RuntimeError('transient'), run_id=identity)
    next_id = uuid4()
    second.on_chat_model_start({}, [], run_id=next_id)
    second.on_llm_end(None, run_id=next_id)
    assert not second.held


def _hold_gate(directory, ready):
    gate = RequestGate('cross-process', 1, .2, directory)
    gate.on_chat_model_start({}, [], run_id='child')
    ready.set()
    time.sleep(30)


def test_request_gate_process_death_releases_capacity(tmp_path):
    ctx = multiprocessing.get_context('spawn')
    ready = ctx.Event()
    process = ctx.Process(target=_hold_gate, args=(str(tmp_path), ready))
    process.start()
    try:
        assert ready.wait(10)
        gate = RequestGate('cross-process', 1, .05, tmp_path)
        with pytest.raises(TimeoutError):
            gate.on_chat_model_start({}, [], run_id='parent')
    finally:
        process.terminate(); process.join(10)
    gate.on_chat_model_start({}, [], run_id='parent')
    gate.on_llm_end(None, run_id='parent')


def test_execution_metrics_preserve_unknown_costs_and_accumulate_attempts(tmp_path):
    UsageRecorder(tmp_path / 'usage.json')
    persistence = ReportPersistence()
    frozen = {'workflow_version': 2, 'analyst_concurrency_limit': 4, 'max_tool_rounds': 5}
    save_execution_metrics(tmp_path, frozen, 1, False, persistence)
    summary = save_execution_metrics(tmp_path, frozen, 2, True, persistence)
    assert summary['elapsed_seconds'] == 3 and len(summary['attempts']) == 2
    assert summary['failure_rate'] is None
    assert (tmp_path / 'reports/execution_summary.md').exists()


def test_request_gate_reconciles_different_snapshot_capacities(tmp_path):
    high = RequestGate('versioned-model', 4, .03, tmp_path)
    low = RequestGate('versioned-model', 1, .03, tmp_path)
    low.on_chat_model_start({}, [], run_id='low')
    with pytest.raises(TimeoutError):
        high.on_chat_model_start({}, [], run_id='high')
    low.on_llm_end(None, run_id='low')
    high.on_chat_model_start({}, [], run_id='high')
    with pytest.raises(TimeoutError):
        low.on_chat_model_start({}, [], run_id='low-again')
    high.on_llm_end(None, run_id='high')


def test_real_sdk_callbacks_gate_quick_deep_and_preserve_usage_prices(tmp_path, monkeypatch):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from stockdepth.workflows.trading_graph import StockDepthGraph
    import threading
    active = peak = 0
    mutex = threading.Lock()
    class MockHTTP(BaseHTTPRequestHandler):
        def do_POST(self):
            nonlocal active, peak
            data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            with mutex:
                active += 1; peak = max(active, peak)
            time.sleep(.04)
            try:
                body = json.dumps({'id': 'fixture-' + str(uuid4()), 'object': 'chat.completion', 'created': 1,
                    'model': data['model'], 'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': 'Rating: Hold'}, 'finish_reason': 'stop'}],
                    'usage': {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15}}).encode()
                self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(body)
            finally:
                with mutex:
                    active -= 1
        def log_message(self, *args): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), MockHTTP)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    monkeypatch.setenv('STOCKDEPTH_RATE_LIMIT_DIR', str(tmp_path / 'gates'))
    recorder = UsageRecorder(tmp_path / 'usage.json')
    graph = StockDepthGraph.__new__(StockDepthGraph)
    graph.config = {}; graph.callbacks = [recorder]
    config = {'id': 42, 'provider': 'openai-compatible', 'model': 'local-fixture',
              'base_url': f'http://127.0.0.1:{server.server_port}/v1', 'api_key': 'fixture-only',
              'options': {'request_concurrency': 2, 'requests_per_minute': 60000, 'timeout': 2, 'max_retries': 0},
              'prices': {'input': '1.25', 'cache': '1.25', 'output': '2.5', 'currency': 'CNY'}}
    try:
        quick = graph._make_role_llm('quick', config)
        deep = graph._make_role_llm('deep', config)
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda llm: llm.invoke('local fixture'), [quick, deep, quick, deep]))
        assert len(results) == 4 and peak == 2
        assert len(recorder.calls) == 4
        assert {c['role'] for c in recorder.calls} == {'quick', 'deep'}
        assert all(c['estimated_cost'] == '0.000025000000' and c['total_tokens'] == 15 for c in recorder.calls)
    finally:
        server.shutdown(); server.server_close(); thread.join(3)


def test_runner_persists_nested_progress_metrics_and_resumes_same_run(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from stockdepth.api import analysis_runner as runner
    from stockdepth.api.server import read_report_files
    from stockdepth.workflows.propagation import Propagator
    from stockdepth.workflows.signal_processing import SignalProcessor
    broken = MockModel(); broken._fail.add('news')
    recovered = MockModel()
    models = iter([broken, recovered])
    configs = []
    def graph_factory(selected_analysts, config, **kwargs):
        configs.append(dict(config))
        workflow = mock_workflow(config['frozen_analyst_concurrency'], next(models), selected_analysts,
                                 workflow_version=config['workflow_version'])
        return SimpleNamespace(workflow=workflow, graph=workflow.compile(), propagator=Propagator(),
            _log_state=lambda *args: None, memory_log=TradingMemoryLog(config),
            process_signal=SignalProcessor().process_signal)
    monkeypatch.setattr(runner, 'StockDepthGraph', graph_factory)
    monkeypatch.setattr(runner, 'load_dotenv', lambda *args, **kwargs: None)
    monkeypatch.setattr(runner, 'DEFAULT_CONFIG', {**runner.DEFAULT_CONFIG,
        'results_dir': str(tmp_path / 'results'), 'data_cache_dir': str(tmp_path / 'cache'),
        'memory_log_path': str(tmp_path / 'memory.md')})
    snapshot = {role: {'id': n, 'provider': 'local-mock', 'model': 'fixture',
                      'options': {'request_concurrency': 4}} for role, n in [('quick', 1), ('deep', 2)]}
    monkeypatch.setenv('STOCKDEPTH_MODEL_CONFIGS', json.dumps(snapshot))
    monkeypatch.setenv('STOCKDEPTH_TIMING_ENABLED', 'false')
    monkeypatch.setattr('sys.argv', ['analysis_runner', '--ticker', 'MOCK', '--date', '2026-10-13',
        '--run-id', 'isolated-job', '--memory-owner', '17', '--checkpoint', '--analyst-concurrency', '4',
        '--analysts', 'market,news,social,fundamentals'])
    with pytest.raises(RuntimeError, match='interruption'):
        runner.main()
    snapshot['quick']['options']['request_concurrency'] = 1
    monkeypatch.setenv('STOCKDEPTH_MODEL_CONFIGS', json.dumps(snapshot))
    runner.main()
    assert configs[0]['frozen_analyst_concurrency'] == configs[1]['frozen_analyst_concurrency'] == 4
    run_dir = tmp_path / 'results/runs/isolated-job'
    assert configs[0]['run_state_dir'] == str(run_dir / 'state_logs')
    assert recovered._calls == {'news': 1}
    calls = read_usage(run_dir / 'usage.json')['calls']
    assert len(calls) == 9 and sum(c['status'] == 'failed' for c in calls) == 1
    metrics = json.loads((run_dir / 'execution_metrics.json').read_text())
    assert metrics['succeeded'] and len(metrics['attempts']) == 2
    assert metrics['failed_calls'] == 1 and not metrics['cost_complete']
    reports = {r['key']: r['content'] for r in read_report_files(run_dir)}
    assert 'market-private-tool-result' in reports['progress']
    assert 'Validated rating: REVIEW' in reports['complete']
    assert 'known_total_tokens' in reports['execution']
    assert not (tmp_path / 'memory.md').exists()


def test_runner_does_not_publish_provisional_pm_report_before_validation(tmp_path):
    from stockdepth.api.analysis_runner import publishable_state, save_report_parts, build_complete_report
    state = {'final_trade_decision': 'Rating: Buy',
             'risk_debate_state': {'judge_decision': 'Rating: Buy'}}
    public = publishable_state(state, 2)
    save_report_parts(public, tmp_path)
    assert not (tmp_path / 'final_trade_decision.md').exists()
    assert 'Portfolio Manager Decision' not in build_complete_report(public, 'MOCK')
    assert state['risk_debate_state']['judge_decision'] == 'Rating: Buy'
    validated = {**state, **validate_decision(state)}
    save_report_parts(publishable_state(validated, 2), tmp_path)
    assert (tmp_path / 'final_trade_decision.md').read_text() == 'Rating: Buy'
