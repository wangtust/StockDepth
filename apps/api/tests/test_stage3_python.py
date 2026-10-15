"""Local Mock only: graph wiring, isolation, accounting and SQLite recovery."""
import threading
import time
from collections import Counter
from pathlib import Path
from unittest.mock import patch

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import tool
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.prebuilt import ToolNode
from pydantic import PrivateAttr

from stockdepth.api.usage import UsageRecorder, read_usage
from stockdepth.workflows import setup
from stockdepth.workflows.analyst_execution import build_analyst_execution_plan
from stockdepth.workflows.propagation import Propagator


class MockModel(BaseChatModel):
    delay: float = 0.025
    _lock: object = PrivateAttr(default_factory=threading.Lock)
    _active: int = PrivateAttr(default=0)
    _peak: int = PrivateAttr(default=0)
    _calls: Counter = PrivateAttr(default_factory=Counter)
    _fail: set = PrivateAttr(default_factory=set)
    _seen: list = PrivateAttr(default_factory=list)

    @property
    def _llm_type(self):
        return 'stage3-local-mock'

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        key = messages[0].content
        with self._lock:
            self._active += 1
            self._peak = max(self._peak, self._active)
            self._calls[key] += 1
            self._seen.append((key, [m.content for m in messages]))
        try:
            time.sleep(self.delay)
            if key in self._fail and any(isinstance(m, ToolMessage) for m in messages):
                self._fail.remove(key)
                raise RuntimeError('local mock interruption')
            if any(isinstance(m, ToolMessage) for m in messages):
                message = AIMessage(content=f'{key}: deterministic report', usage_metadata={'input_tokens':10,'output_tokens':5,'total_tokens':15})
            else:
                message = AIMessage(content='', tool_calls=[{'name':'local_data','args':{'key':key},'id':f'{key}-tool','type':'tool_call'}],usage_metadata={'input_tokens':10,'output_tokens':5,'total_tokens':15})
            return ChatResult(generations=[ChatGeneration(message=message)])
        finally:
            with self._lock:
                self._active -= 1


@tool
def local_data(key: str) -> str:
    """Return deterministic local data without network access."""
    return f'{key}-private-tool-result'


def mock_workflow(concurrency, model, selected=None, **options):
    selected = selected or ['market','news','social','fundamentals']
    plan = build_analyst_execution_plan(selected,concurrency)
    def factory(spec):
        def analyst(state, config):
            # The real analyst prompt uses its own identity plus local messages.
            from langchain_core.messages import SystemMessage
            message = model.invoke([SystemMessage(content=spec.key), *state['messages']], config=config)
            result = {'messages':[message]}
            if not message.tool_calls:
                result[spec.report_key] = message.content
            return result
        return lambda llm: analyst
    def downstream(state):
        return {'final_trade_decision':'|'.join(state[s.report_key] for s in plan.specs)}
    class Logic:
        def __getattr__(self,name):
            if name.startswith('should_continue_') and name.removeprefix('should_continue_') in [s.key for s in plan.specs]:
                spec=next(s for s in plan.specs if name.endswith('_'+s.key))
                return lambda state: spec.tool_node if state['messages'][-1].tool_calls else spec.clear_node
            if name=='should_continue_debate': return lambda state:'Research Manager'
            if name=='should_continue_risk_analysis': return lambda state:'Portfolio Manager'
            raise AttributeError(name)
    with patch.multiple(setup, **{f'create_{name}':factory(spec) for spec in plan.specs for name in [{'market':'market_analyst','news':'news_analyst','social':'sentiment_analyst','fundamentals':'fundamentals_analyst'}[spec.key]]}), patch.multiple(setup,**{f'create_{name}':lambda llm:downstream for name in ['bull_researcher','bear_researcher','research_manager','trader','aggressive_debator','neutral_debator','conservative_debator','portfolio_manager']}):
        return setup.GraphSetup(model,model,{s.key:ToolNode([local_data]) for s in plan.specs},Logic(),concurrency, **options).setup_graph([s.key for s in plan.specs])


def initial():
    return Propagator().create_initial_state('MOCK','2026-10-13')


@pytest.mark.parametrize('concurrency',[1,2])
def test_isolation_merge_and_identity(tmp_path,concurrency):
    model=MockModel(); recorder=UsageRecorder(tmp_path/'usage.json')
    bound=model.with_config(metadata={'model_role':'quick','model_config_id':123,'model_provider':'local-mock','model_name':'mock','pricing_snapshot':{'input':'1.25','cache':'1.25','output':'2.50','currency':'CNY'}})
    # Patch invoke metadata on the model through workflow's model argument.
    graph=mock_workflow(concurrency,bound).compile()
    result=graph.invoke(initial(),{'callbacks':[recorder]})
    assert all(result[s.report_key]==f'{s.key}: deterministic report' for s in build_analyst_execution_plan(['market','news','social','fundamentals']).specs)
    assert [m.content for m in result['messages']]==['Continue']
    assert model._peak==concurrency
    for key,contents in model._seen:
        assert all(other+'-private-tool-result' not in contents for other in ['market','news','social','fundamentals'] if other!=key)
    calls=read_usage(tmp_path/'usage.json')['calls']
    assert len(calls)==8
    assert sum(c['total_tokens'] for c in calls)==120
    assert all(c['role']=='quick' and c['model_config_id']==123 and c['provider']=='local-mock' and c['pricing_snapshot']['input']=='1.25' for c in calls)
    assert all(c['estimated_cost']=='0.000025000000' and c['cost_complete'] for c in calls)
    assert {c['agent'] for c in calls}=={'Market Analyst','News Analyst','Sentiment Analyst','Fundamentals Analyst'}
    reopened=UsageRecorder(tmp_path/'usage.json')
    assert reopened.calls==calls  # snapshot survives recorder/process restart


def test_parallel_resume_preserves_completed_sibling_and_tool_step(tmp_path):
    model=MockModel(); model._fail.add('news')
    workflow=mock_workflow(2,model)
    config={'configurable':{'thread_id':'stage3-isolated'}}
    with SqliteSaver.from_conn_string(str(tmp_path/'checkpoint.sqlite')) as saver:
        graph=workflow.compile(checkpointer=saver)
        with pytest.raises(RuntimeError,match='interruption'):
            graph.invoke(initial(),config)
        before=dict(model._calls)
    # New model, workflow and saver: no retained Python graph/model state.
    resumed_model=MockModel()
    with SqliteSaver.from_conn_string(str(tmp_path/'checkpoint.sqlite')) as saver:
        result=mock_workflow(2,resumed_model).compile(checkpointer=saver).invoke(None,config)
    assert model._calls['market']==before['market']==2
    assert resumed_model._calls['market']==0
    assert resumed_model._calls['news']==1  # tool request is not reissued
    assert result['news_report']=='news: deterministic report'
    assert resumed_model._calls['social']==resumed_model._calls['fundamentals']==2


def test_maximum_default_and_explicit_serial_compatibility():
    from stockdepth.default_config import DEFAULT_CONFIG
    assert DEFAULT_CONFIG['analyst_concurrency_limit']==4
    assert MockModel()._peak==0
    graph=mock_workflow(1,MockModel()).compile()
    assert 'Market Analyst' in graph.nodes and 'Msg Clear News' in graph.nodes


@pytest.mark.parametrize('invalid',[0,3,True,1.5,"2"])
def test_invalid_concurrency(invalid):
    with pytest.raises(ValueError):
        build_analyst_execution_plan(['market'],invalid)


def test_duplicate_analyst_rejected():
    with pytest.raises(ValueError,match='duplicate'):
        build_analyst_execution_plan(['market','market'],2)


def test_snapshot_capacity_clamp():
    from stockdepth.workflows.analyst_execution import effective_analyst_concurrency as limit
    assert limit({})==4
    assert limit({'analyst_concurrency_limit':2})==2
    for capacity,expected in [(1,1),(2,2),(4,2)]:
        assert limit({'analyst_concurrency_limit':2,'model_configs':{'quick':{'options':{'request_concurrency':capacity}}}})==expected
    assert limit({'analyst_concurrency_limit':2,'model_configs':{'quick':{}}})==2
    with pytest.raises(ValueError):
        limit({'model_configs':{'quick':{'options':{'request_concurrency':1.5}}}})


@pytest.mark.parametrize('concurrency',[1,2])
def test_real_analyst_factories_with_local_model_and_tools(concurrency):
    """Exercise production prompt factories without providers or data fetches."""
    from contextlib import ExitStack
    from stockdepth.agents.analysts import market_analyst, news_analyst
    from stockdepth.workflows.conditional_logic import ConditionalLogic
    class PromptMock(MockModel):
        def bind_tools(self, tools, **kwargs):
            return self

        def _generate(self,messages,**kwargs):
            from langchain_core.messages import SystemMessage
            key='news' if 'news researcher' in messages[0].content else 'market'
            return super()._generate([SystemMessage(content=key),*messages[1:]],**kwargs)
    model=PromptMock()
    def final(state):
        return {'final_trade_decision':state['market_report']+'|'+state['news_report']}
    class Logic(ConditionalLogic):
        def should_continue_debate(self,state): return 'Research Manager'
        def should_continue_risk_analysis(self,state): return 'Portfolio Manager'
    with ExitStack() as stack:
        for module in [market_analyst,news_analyst]:
            stack.enter_context(patch.object(module,'build_instrument_context',return_value='local MOCK instrument'))
            stack.enter_context(patch.object(module,'get_language_instruction',return_value=''))
        stack.enter_context(patch.multiple(setup,**{f'create_{name}':lambda llm:final for name in ['bull_researcher','bear_researcher','research_manager','trader','aggressive_debator','neutral_debator','conservative_debator','portfolio_manager']}))
        graph=setup.GraphSetup(model,model,{'market':ToolNode([local_data]),'news':ToolNode([local_data])},Logic(),concurrency).setup_graph(['market','news']).compile()
        result=graph.invoke(initial())
    assert result['final_trade_decision']=='market: deterministic report|news: deterministic report'
    assert model._calls=={'market':2,'news':2}
    assert model._peak==concurrency
    assert 'MOCK' in model._seen[0][1]  # preserve first analyst's original input
    assert [m.content for m in result['messages']]==['Continue']


def test_nested_timing_callbacks_no_message_payload(tmp_path):
    import json
    from stockdepth.api.timing import TimingRecorder
    timing=TimingRecorder(tmp_path/'timing',job_id='isolated-mock')
    mock_workflow(2,MockModel()).compile().invoke(initial(),{'callbacks':[timing]})
    timing.close()
    data=json.loads((tmp_path/'timing/timing-summary.json').read_text())
    assert sum(g['count'] for g in data['groups'] if g['kind']=='model')==8
    assert sum(g['count'] for g in data['groups'] if g['kind']=='tool')==4
    assert all(g['errors']==0 for g in data['groups'])
    payload=(tmp_path/'timing/timing.jsonl').read_text()
    assert 'private-tool-result' not in payload and 'deterministic report' not in payload


@pytest.mark.parametrize('selected',[['news'],['social','market'],['fundamentals','news','market'],['social','fundamentals','market','news']])
def test_subset_order_and_bounded_batches(selected):
    serial=mock_workflow(1,MockModel(),selected).compile().invoke(initial())
    model=MockModel()
    parallel=mock_workflow(2,model,selected).compile().invoke(initial())
    assert {k:v for k,v in serial.items() if k!='messages'}=={k:v for k,v in parallel.items() if k!='messages'}
    assert model._peak==min(2,len(selected))
    assert [m.content for m in parallel['messages']]==['Continue']


def test_before_stage_serial_checkpoint_compatible(tmp_path):
    import importlib.util
    import sys
    original=sys.modules[__name__].setup
    # Generate the independent Mock legacy graph within pytest's temporary workspace.
    template=Path(__file__).parent/'fixtures/legacy_serial_graph.py'
    source=tmp_path/'legacy_serial_graph.py'
    source.write_text(template.read_text())
    try:
        spec=importlib.util.spec_from_file_location('stockdepth.workflows.stage3_before_setup',source)
        before=importlib.util.module_from_spec(spec);spec.loader.exec_module(before)
        model=MockModel();model._fail.add('news')
        config={'configurable':{'thread_id':'legacy-serial'}}
        with patch.object(sys.modules[__name__],'setup',before):
            workflow=mock_workflow(1,model)
        with SqliteSaver.from_conn_string(str(tmp_path/'legacy.sqlite')) as saver:
            with pytest.raises(RuntimeError):
                workflow.compile(checkpointer=saver).invoke(initial(),config)
        resumed=MockModel()
        with SqliteSaver.from_conn_string(str(tmp_path/'legacy.sqlite')) as saver:
            result=mock_workflow(1,resumed).compile(checkpointer=saver).invoke(None,config)
        assert resumed._calls['market']==0 and resumed._calls['news']==1
        assert result['market_report']=='market: deterministic report'
        assert sys.modules[__name__].setup is original
    finally:
        source.unlink(missing_ok=True)
