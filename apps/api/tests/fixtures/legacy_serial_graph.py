"""Independent synthetic serial graph with legacy checkpoint node identities.

Only topology is reproduced; the caller supplies Mock analysts and tools.
This fixture deliberately does not use the current GraphSetup implementation.
"""
from langgraph.graph import START, END, StateGraph
from stockdepth.agents import (
    create_market_analyst, create_news_analyst, create_sentiment_analyst,
    create_fundamentals_analyst, create_msg_delete, create_bull_researcher,
    create_bear_researcher, create_research_manager, create_trader,
    create_aggressive_debator, create_neutral_debator,
    create_conservative_debator, create_portfolio_manager,
)
from stockdepth.agents.utils.agent_states import AgentState


class GraphSetup:
    def __init__(self, quick, deep, tool_nodes, conditional_logic, concurrency=1):
        assert concurrency == 1
        self.quick, self.deep = quick, deep
        self.tools, self.logic = tool_nodes, conditional_logic

    def setup_graph(self, selected):
        # Preserve legacy node names and the caller-selected serial order.
        definitions = [
            ('market', 'Market Analyst', create_market_analyst),
            ('social', 'Sentiment Analyst', create_sentiment_analyst),
            ('news', 'News Analyst', create_news_analyst),
            ('fundamentals', 'Fundamentals Analyst', create_fundamentals_analyst),
        ]
        analysts = [next(item for item in definitions if item[0] == key) for key in selected]
        assert analysts
        graph = StateGraph(AgentState)
        for index, (key, name, factory) in enumerate(analysts):
            clear, tools = ('Msg Clear Sentiment' if key == 'social' else f'Msg Clear {key.capitalize()}'), f'tools_{key}'
            graph.add_node(name, factory(self.quick))
            graph.add_node(clear, create_msg_delete())
            graph.add_node(tools, self.tools[key])
            graph.add_conditional_edges(name, getattr(self.logic, f'should_continue_{key}'), [tools, clear])
            graph.add_edge(tools, name)
            graph.add_edge(clear, analysts[index + 1][1] if index + 1 < len(analysts) else 'Bull Researcher')
        graph.add_edge(START, analysts[0][1])
        for name, factory, model in [
            ('Bull Researcher', create_bull_researcher, self.quick),
            ('Bear Researcher', create_bear_researcher, self.quick),
            ('Research Manager', create_research_manager, self.deep),
            ('Trader', create_trader, self.quick),
            ('Aggressive Analyst', create_aggressive_debator, self.quick),
            ('Neutral Analyst', create_neutral_debator, self.quick),
            ('Conservative Analyst', create_conservative_debator, self.quick),
            ('Portfolio Manager', create_portfolio_manager, self.deep),
        ]:
            graph.add_node(name, factory(model))
        for name in ['Bull Researcher', 'Bear Researcher']:
            graph.add_conditional_edges(name, self.logic.should_continue_debate,
                                        ['Bull Researcher', 'Bear Researcher', 'Research Manager'])
        graph.add_edge('Research Manager', 'Trader')
        graph.add_edge('Trader', 'Aggressive Analyst')
        for name in ['Aggressive Analyst', 'Neutral Analyst', 'Conservative Analyst']:
            graph.add_conditional_edges(name, self.logic.should_continue_risk_analysis,
                                        ['Aggressive Analyst', 'Neutral Analyst', 'Conservative Analyst', 'Portfolio Manager'])
        graph.add_edge('Portfolio Manager', END)
        return graph
