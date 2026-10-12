from functools import lru_cache

from langchain_core.messages import HumanMessage, RemoveMessage

# Import tools from separate utility files
from stockdepth.agents.utils.core_stock_tools import (
    get_stock_data
)
from stockdepth.agents.utils.technical_indicators_tools import (
    get_indicators
)
from stockdepth.agents.utils.fundamental_data_tools import (
    get_fundamentals,
    get_balance_sheet,
    get_cashflow,
    get_income_statement
)
from stockdepth.agents.utils.news_data_tools import (
    get_news,
    get_insider_transactions,
    get_global_news
)


def get_language_instruction() -> str:
    """Return a prompt instruction for the configured output language.

    Returns empty string when English (default), so no extra tokens are used.
    Applied to every agent whose output reaches the saved report —
    analysts, researchers, debaters, research manager, trader, and
    portfolio manager — so a non-English run produces a fully localized
    report rather than a mix of languages.
    """
    from stockdepth.data.config import get_config
    lang = get_config().get("output_language", "English")
    if lang.strip().lower() == "english":
        return ""
    return f" Write your entire response in {lang}."


@lru_cache(maxsize=256)
def resolve_instrument_identity(ticker: str) -> str:
    """Return a verified name/code hint for tickers when a lightweight source exists."""
    try:
        from stockdepth.data.chinese_market import (
            fetch_eastmoney_stock_profile,
            is_chinese_market_ticker,
        )

        if is_chinese_market_ticker(ticker):
            profile = fetch_eastmoney_stock_profile(ticker)
            parts = [f"`{ticker}`"]
            if profile.get("code"):
                parts.append(f"exchange code `{profile['code']}`")
            if profile.get("name"):
                parts.append(f"company name `{profile['name']}`")
            if profile.get("industry"):
                parts.append(f"industry `{profile['industry']}`")
            if len(parts) > 1:
                return ", ".join(parts)
    except Exception:
        return ""
    return ""


def build_instrument_context(ticker: str, asset_type: str = "stock") -> str:
    """Describe the exact instrument so agents preserve exchange-qualified tickers."""
    instrument_label = "asset" if asset_type == "crypto" else "instrument"
    identity = resolve_instrument_identity(ticker) if asset_type != "crypto" else ""
    identity_hint = (
        " Verified instrument identity: "
        f"{identity}. Treat this identity as authoritative for naming; do not infer, "
        "translate, or substitute a different company name from memory. If any source "
        "appears to conflict with it, flag that as a data-quality issue and keep this "
        "ticker/name pairing."
        if identity
        else " Do not introduce a company name unless it is supported by fetched data; "
        "use the ticker itself when uncertain."
    )
    extra_hint = (
        " Treat it as a crypto asset rather than a company, and do not assume company fundamentals are available."
        if asset_type == "crypto"
        else ""
    )
    return (
        f"The {instrument_label} to analyze is `{ticker}`. "
        "Use this exact ticker in every tool call, report, and recommendation, "
        "preserving any exchange suffix (e.g. `.TO`, `.L`, `.HK`, `.T`, `-USD`)."
        + identity_hint
        + extra_hint
    )

def create_msg_delete():
    def delete_messages(state):
        """Clear messages and add placeholder for Anthropic compatibility"""
        messages = state["messages"]

        # Remove all messages
        removal_operations = [RemoveMessage(id=m.id) for m in messages]

        # Add a minimal placeholder message
        placeholder = HumanMessage(content="Continue")

        return {"messages": removal_operations + [placeholder]}

    return delete_messages


        
