from stockdepth.agents.analysts.turn import take_turn
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from stockdepth.agents.utils.agent_utils import (
    build_instrument_context,
    get_global_news,
    get_language_instruction,
    get_news,
)
from stockdepth.data.config import get_config


def create_news_analyst(llm):
    def news_analyst_node(state):
        current_date = state["trade_date"]
        asset_type = state.get("asset_type", "stock")
        asset_label = "company" if asset_type == "stock" else "asset"
        instrument_context = state.get("instrument_context") or build_instrument_context(
            state["company_of_interest"], asset_type
        )

        tools = [
            get_news,
            get_global_news,
        ]

        system_message = (
            f"You are a news researcher tasked with analyzing recent news and trends over the past week. Please write a comprehensive report of the current state of the world that is relevant for trading and macroeconomics. Use the available tools: get_news for {asset_label}-specific news in a date window, and get_global_news for broader macroeconomic news. Provide specific, actionable insights with supporting evidence to help traders make informed decisions."
            + """ Make sure to append a Markdown table at the end of the report to organize key points in the report, organized and easy to read."""
            + get_language_instruction()
        )

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "You are a helpful AI assistant, collaborating with other assistants."
                    " Use the provided tools to progress towards answering the question."
                    " If you are unable to fully answer, that's OK; another assistant with different tools"
                    " will help where you left off. Execute what you can to make progress."
                    " Report only supported research findings and missing evidence. Another role decides the trade."
                    " You have access to the following tools: {tool_names}.\n{system_message}"
                    "For your reference, the current date is {current_date}. {instrument_context}",
                ),
                MessagesPlaceholder(variable_name="messages"),
            ]
        )

        system_message = str(system_message) + "\n" + state.get("market_evidence", "")
        prompt = prompt.partial(system_message=system_message)
        prompt = prompt.partial(tool_names=", ".join([tool.name for tool in tools]))
        prompt = prompt.partial(current_date=current_date)
        prompt = prompt.partial(instrument_context=instrument_context)

        result = take_turn(prompt, llm, tools, state["messages"])

        report = ""

        if len(result.tool_calls) == 0:
            report = result.content

        return {
            "messages": [result],
            "news_report": report,
        }

    return news_analyst_node
