"""Trader: turns the Research Manager's investment plan into a concrete transaction proposal."""

from __future__ import annotations

import functools
from stockdepth.agents.context import decision_context, report_or_absent

from langchain_core.messages import AIMessage

from stockdepth.agents.schemas import TraderProposal, render_trader_proposal
from stockdepth.agents.utils.agent_utils import (
    build_instrument_context,
    get_language_instruction,
)
from stockdepth.agents.utils.structured import (
    bind_structured,
    invoke_structured_or_freetext,
)


def create_trader(llm):
    structured_llm = bind_structured(llm, TraderProposal, "Trader")

    def trader_node(state, name):
        company_name = state["company_of_interest"]
        asset_type = state.get("asset_type", "stock")
        instrument_context = state.get("instrument_context") or build_instrument_context(company_name, asset_type)
        investment_plan = state["investment_plan"]
        evidence = decision_context(state)
        technical = report_or_absent(state.get("market_report"), "Technical analysis")

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a trading agent analyzing market data to make investment decisions. "
                    "Based on your analysis, provide a specific recommendation to buy, sell, or hold. "
                    "Anchor your reasoning in the analysts' reports and the research plan. "
                    "Ground entry and stop in the supplied market evidence and technical report. "
                    "Use a single positive absolute price in quote currency, never a percentage or range. "
                    "Omit numeric levels when evidence is unavailable. Overweight implies Buy and Underweight implies Sell; "
                    "size relative to the supplied portfolio, or give conditional guidance when holdings are unknown."
                    + get_language_instruction()
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Based on a comprehensive analysis by a team of analysts, here is an investment "
                    f"plan tailored for {company_name}. {instrument_context} This plan incorporates "
                    f"insights from current technical market trends, macroeconomic indicators, and "
                    f"social media sentiment. Use this plan as a foundation for evaluating your next "
                    f"trading decision.\n\n{evidence}\n\nTechnical report: {technical}\n\nProposed Investment Plan: {investment_plan}\n\n"
                    f"Leverage these insights to make an informed and strategic decision."
                ),
            },
        ]

        trader_plan = invoke_structured_or_freetext(
            structured_llm,
            llm,
            messages,
            render_trader_proposal,
            "Trader",
        )

        return {
            "messages": [AIMessage(content=trader_plan)],
            "trader_investment_plan": trader_plan,
            "sender": name,
        }

    return functools.partial(trader_node, name="Trader")
