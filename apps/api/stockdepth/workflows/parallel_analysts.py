"""Opt-in bounded fan-out; each analyst has a checkpointed private tool loop.

Do not catch errors and replay serially: a submitted model request may be billed.
Fallback means selecting concurrency=1 before starting a fresh run. Resume must
use the same topology/selection. SDK client thread safety is provider dependent.
"""
from copy import deepcopy

from langchain_core.messages import HumanMessage
from langgraph.graph import END, START, StateGraph

from stockdepth.agents.utils.agent_states import AgentState
from stockdepth.agents.utils.agent_utils import create_msg_delete


def isolated_analyst(spec, analyst, tools, conditional_logic, first=False):
    child = StateGraph(AgentState)
    child.add_node(spec.agent_node, analyst)
    child.add_node(spec.tool_node, tools)
    child.add_node(spec.clear_node, create_msg_delete())
    child.add_edge(START, spec.agent_node)
    child.add_conditional_edges(
        spec.agent_node,
        getattr(conditional_logic, f"should_continue_{spec.key}"),
        [spec.tool_node, spec.clear_node],
    )
    child.add_edge(spec.tool_node, spec.agent_node)
    child.add_edge(spec.clear_node, END)
    # Parent saver is inherited, with a namespace per nested invocation.
    graph = child.compile()

    def run(state, config):
        private = deepcopy(state)
        if not first:
            private['messages'] = [HumanMessage(content='Continue')]
        # Analysts are independent: don't expose a sibling's earlier report.
        for key in ('market_report', 'news_report', 'sentiment_report', 'fundamentals_report'):
            private[key] = ''
        result = graph.invoke(private, config)
        # No shared sender/messages/debate updates; unique report channel only.
        return {spec.report_key: result[spec.report_key]}

    return run


def add_parallel_analysts(workflow, plan, factories, tools, logic, next_node):
    previous = START
    for offset in range(0, len(plan.specs), plan.concurrency_limit):
        batch = plan.specs[offset:offset + plan.concurrency_limit]
        names = []
        for spec in batch:
            name = f'Isolated {spec.agent_node}'
            workflow.add_node(name, isolated_analyst(spec, factories[spec.key](), tools[spec.key], logic, first=spec == plan.specs[0]))
            workflow.add_edge(previous, name)
            names.append(name)
        barrier = f'Analyst Barrier {offset // plan.concurrency_limit}'
        workflow.add_node(barrier, lambda state: {})
        workflow.add_edge(names, barrier)
        previous = barrier
    workflow.add_node('Parallel Analyst Messages Clear', create_msg_delete())
    workflow.add_edge(previous, 'Parallel Analyst Messages Clear')
    workflow.add_edge('Parallel Analyst Messages Clear', next_node)
