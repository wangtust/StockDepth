"""Offline acceptance for evidence-grounded v3 agents."""
import json
from unittest.mock import Mock, patch
import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables import RunnableLambda
from langchain_core.utils.function_calling import convert_to_openai_tool
from langgraph.graph import START, END, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.sqlite import SqliteSaver
from stockdepth.agents.analysts.turn import take_turn, WRAP_UP
from stockdepth.agents.context import portfolio_context, opponent_argument_or_opening, report_or_absent
from stockdepth.agents.portfolio import PortfolioContext
from stockdepth.agents import runtime_tools
from stockdepth.agents.schemas import TraderProposal
from stockdepth.agents.trader.trader import create_trader
from stockdepth.agents.utils.agent_states import AgentState
from stockdepth.workflows.market_evidence import build_market_evidence, market_evidence_node
from stockdepth.workflows.research_validation import validate_decision
from stockdepth.workflows.execution_config import execution_config
from stockdepth.workflows.trading_graph import StockDepthGraph
from .test_stage3_python import MockModel, mock_workflow, initial


def evidence():
    return {'market_snapshot': {'close': 100, 'latest_bar_date': '2026-10-13'}, 'market_evidence': 'Verified close 100, support 95, resistance 110'}


@pytest.mark.parametrize('concurrency', [1, 2, 4])
def test_v3_evidence_barrier_and_checkpoint_recovery(tmp_path, concurrency):
    broken = MockModel(); broken._fail.add('news')
    cfg = {'configurable': {'thread_id': 'evidence-v3'}}
    seen = []
    def snapshot(state):
        seen.append('snapshot')
        return evidence()
    with SqliteSaver.from_conn_string(str(tmp_path / 'checkpoint.db')) as saver:
        with pytest.raises(RuntimeError, match='interruption'):
            mock_workflow(concurrency, broken, workflow_version=3, evidence_node=snapshot).compile(checkpointer=saver).invoke(initial(), cfg)
    recovered = MockModel()
    with SqliteSaver.from_conn_string(str(tmp_path / 'checkpoint.db')) as saver:
        result = mock_workflow(concurrency, recovered, workflow_version=3, evidence_node=snapshot).compile(checkpointer=saver).invoke(None, cfg)
    assert seen == ['snapshot']
    assert result['market_snapshot']['close'] == 100
    assert recovered._calls['news'] == 1
    if concurrency == 4:
        assert recovered._calls == {'news': 1}
    assert result['research_status']['market'] == 'complete'


def test_snapshot_excludes_future_rows_and_preserves_exchange_date():
    csv = '# Vendor OHLCV\nDate,Open,Close\n2026-10-12 00:00:00+08:00,98,99\n2026-10-13 00:00:00+08:00,99,100\n2026-10-14 00:00:00+08:00,100,999\n'
    with patch('stockdepth.workflows.market_evidence.route_to_vendor', return_value=csv):
        result = build_market_evidence('MOCK.HK', '2026-10-13')
    assert result['close'] == 100 and result['latest_bar_date'] == '2026-10-13'
    assert result['bars'] == 2 and 'sma_20' not in result


def test_missing_snapshot_degrades_without_disclosing_provider_error():
    with patch('stockdepth.workflows.market_evidence.route_to_vendor', side_effect=RuntimeError('private-provider-key')):
        result = market_evidence_node(initial())
    assert result['market_snapshot'] == {} and 'private-provider-key' not in result['market_evidence']


def test_injected_tool_schema_hides_instrument_and_date_and_uses_run_state():
    schema = convert_to_openai_tool(runtime_tools.get_stock_data)['function']['parameters']['properties']
    assert set(schema) == {'start_date'}
    graph = StateGraph(AgentState)
    graph.add_node('tools', ToolNode([runtime_tools.get_stock_data])); graph.add_edge(START, 'tools'); graph.add_edge('tools', END)
    state = initial()
    state['messages'] = [AIMessage(content='', tool_calls=[{'id': 'x', 'name': 'get_stock_data', 'args': {'symbol': 'WRONG', 'trade_date': '2099-01-01', 'start_date': '2026-10-01'}}])]
    with patch.object(runtime_tools, 'route_to_vendor', return_value='known prices') as route, patch('stockdepth.data.config.get_config', return_value={}):
        result = graph.compile().invoke(state)
    route.assert_called_once_with('get_stock_data', 'MOCK', '2026-10-01', '2026-10-13')
    assert result['messages'][-1].content == 'known prices'


def test_final_turn_removes_tool_bindings_and_protocol_messages():
    observed = []
    llm = RunnableLambda(lambda prompt: (observed.append(prompt.to_messages()) or AIMessage(content='Evidence-backed report')))
    prompt = ChatPromptTemplate.from_messages([('system', 'Tools: {tool_names}'), MessagesPlaceholder('messages')]).partial(tool_names='get_stock_data')
    history = [AIMessage(content='', tool_calls=[{'id': 'x', 'name': 'get_stock_data', 'args': {}}]), ToolMessage(content='close=100', tool_call_id='x'), HumanMessage(content=WRAP_UP)]
    result = take_turn(prompt, llm, [], history)
    assert result.content == 'Evidence-backed report'
    assert not any(isinstance(m, ToolMessage) or getattr(m, 'tool_calls', []) for m in observed[0])
    assert 'none; report only' in observed[0][0].content
    assert any('close=100' in m.content for m in observed[0])


def test_trader_gets_snapshot_technical_report_and_unknown_portfolio():
    llm = Mock()
    llm.with_structured_output.side_effect = NotImplementedError
    llm.invoke.return_value = AIMessage(content='Action: Hold')
    state = {**initial(), **evidence(), 'investment_plan': 'Rating: Buy', 'market_report': 'ATR evidence 2.0'}
    create_trader(llm)(state)
    prompt = str(llm.invoke.call_args.args[0])
    assert 'ATR evidence 2.0' in prompt and 'Verified close 100' in prompt
    assert 'do not assume an empty account' in prompt and 'absolute price' in prompt


@pytest.mark.parametrize('proposal', ['**Entry Price**: 5%', '**Entry Price**: 95-100', '**Action**: Buy\n**Entry Price**: 100\n**Stop Loss**: 105'])
def test_invalid_proposal_requires_review(proposal):
    result = validate_decision({'final_trade_decision': 'Rating: Buy', 'trader_investment_plan': proposal, **evidence()})
    assert result['decision_rating'] == 'REVIEW'


def test_numeric_proposal_without_market_evidence_requires_review():
    assert validate_decision({'final_trade_decision': 'Rating: Buy', 'trader_investment_plan': '**Entry Price**: 100', 'market_snapshot': {}})['decision_rating'] == 'REVIEW'


def test_portfolio_unknown_flat_validation_and_resume_identity(tmp_path):
    assert 'unknown' in portfolio_context({})
    flat = PortfolioContext(positions=[], cash=1000, currency='CNY')
    assert 'positions":[]' in flat.render()
    cfg = {'portfolio_fingerprint': flat.fingerprint()}
    execution_config(tmp_path, cfg, ['market'])
    with pytest.raises(ValueError, match='identity'):
        execution_config(tmp_path, {'portfolio_fingerprint': PortfolioContext(cash=999).fingerprint()}, ['market'])
    for value in (float('nan'), float('inf'), -1):
        with pytest.raises(ValueError):
            PortfolioContext(cash=value)


def test_memory_failures_leave_public_note_and_allow_analysis():
    graph = StockDepthGraph.__new__(StockDepthGraph)
    graph.memory_log = Mock(); graph.memory_log.get_past_context.side_effect = OSError('private-path')
    graph._resolve_pending_entries = Mock(side_effect=RuntimeError('private-key'))
    from datetime import date
    result = graph._memory_node({**initial(), 'trade_date': date.today().isoformat()})
    assert result['past_context'] == '' and 'analysis continues' in result['memory_note']
    assert 'private' not in result['memory_note']


def test_opening_and_absence_are_explicit():
    assert 'has not spoken' in opponent_argument_or_opening('', 'Bear')
    assert 'not a neutral finding' in report_or_absent('', 'news')


def test_production_v3_market_factory_and_injected_tool_loop(tmp_path):
    from types import SimpleNamespace
    from langchain_core.outputs import ChatGeneration, ChatResult
    from stockdepth.default_config import DEFAULT_CONFIG
    from stockdepth.data import config as data_config
    from stockdepth.workflows import setup
    class ResearchModel(MockModel):
        def bind_tools(self, tools, **kwargs):
            assert 'symbol' not in convert_to_openai_tool(tools[0])['function']['parameters']['properties']
            return self
        def _generate(self, messages, **kwargs):
            if any(isinstance(m, ToolMessage) for m in messages):
                message = AIMessage(content='Technical research based on supplied evidence')
            else:
                message = AIMessage(content='', tool_calls=[{'id': 'price', 'name': 'get_stock_data', 'args': {'start_date': '2026-10-01'}}])
            return ChatResult(generations=[ChatGeneration(message=message)])
    model = ResearchModel()
    cfg = {**DEFAULT_CONFIG, 'workflow_version': 3, 'results_dir': str(tmp_path / 'reports'),
           'data_cache_dir': str(tmp_path / 'cache'), 'memory_log_path': None,
           'analysis_date': '2026-10-13', 'realtime_data': False}
    csv = 'Date,Open,High,Low,Close,Volume\n2026-10-13,99,101,98,100,1000\n'
    def downstream(state):
        return {'final_trade_decision': 'Rating: Buy', 'investment_debate_state': {'count': 2, 'current_response': 'Bull'},
                'risk_debate_state': {'count': 3, 'latest_speaker': 'Aggressive'}}
    factories = {f'create_{name}': lambda llm: downstream for name in ['bull_researcher', 'bear_researcher', 'research_manager', 'trader', 'aggressive_debator', 'neutral_debator', 'conservative_debator', 'portfolio_manager']}
    with patch.object(data_config, '_config', {}), patch('stockdepth.workflows.trading_graph.create_llm_client', return_value=SimpleNamespace(get_llm=lambda: model)), patch.multiple(setup, **factories), patch('stockdepth.workflows.market_evidence.route_to_vendor', return_value=csv), patch.object(runtime_tools, 'route_to_vendor', return_value=csv) as route:
        graph = StockDepthGraph(selected_analysts=['market'], config=cfg)
        state = {**initial(), 'instrument_context': 'Resolved MOCK instrument'}
        result = graph.graph.invoke(state)
        managed = {key: value for key, value in cfg.items() if key != 'workflow_version'}
        managed['checkpoint_enabled'] = True
        with patch.object(StockDepthGraph, '_log_state'):
            direct = StockDepthGraph(selected_analysts=['market'], config=managed)
            direct.propagate('MOCK', '2026-10-13')
        saved = json.loads((tmp_path / 'reports/MOCK/2026-10-13/execution/execution.json').read_text())
        assert saved['workflow_version'] == 3 and saved['analyst_concurrency_limit'] == 4
    assert result['decision_rating'] == 'Buy'
    assert result['market_snapshot']['close'] == 100
    assert route.call_count == 2
    assert all(c.args == ('get_stock_data', 'MOCK', '2026-10-01', '2026-10-13') for c in route.call_args_list)
