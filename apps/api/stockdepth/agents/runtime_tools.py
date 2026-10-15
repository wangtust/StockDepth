"""Run-owned instrument/date injection; legacy tools remain available for v1/v2."""
from typing import Annotated
from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState
from stockdepth.data.interface import route_to_vendor

Symbol = Annotated[str, InjectedState('company_of_interest')]
Cutoff = Annotated[str, InjectedState('trade_date')]


def cutoff_date(trade_date):
    from datetime import date
    from stockdepth.data.config import get_config
    return date.today().isoformat() if get_config().get('realtime_data') else trade_date


@tool
def get_stock_data(symbol: Symbol, start_date: str, trade_date: Cutoff) -> str:
    """Read OHLCV from start_date through the run's analysis date. Instrument and cutoff are supplied by the system."""
    return route_to_vendor('get_stock_data', symbol, start_date, cutoff_date(trade_date))


@tool
def get_indicators(symbol: Symbol, indicator: str, trade_date: Cutoff, look_back_days: int = 30) -> str:
    """Read an indicator at the run's analysis date for the run's instrument."""
    from stockdepth.agents.utils.technical_indicators_tools import get_indicators as original
    return original.func(symbol, indicator, cutoff_date(trade_date), look_back_days)


@tool
def get_news(ticker: Symbol, start_date: str, trade_date: Cutoff) -> str:
    """Read instrument news from start_date through the run's analysis date."""
    return route_to_vendor('get_news', ticker, start_date, cutoff_date(trade_date))


@tool
def get_global_news(trade_date: Cutoff, look_back_days: int = 7, limit: int = 10) -> str:
    """Read macro news as of the run's analysis date."""
    return route_to_vendor('get_global_news', cutoff_date(trade_date), look_back_days, limit)


@tool
def get_fundamentals(ticker: Symbol, trade_date: Cutoff) -> str:
    """Read available instrument fundamentals as of the analysis date."""
    return route_to_vendor('get_fundamentals', ticker, cutoff_date(trade_date))


@tool
def get_balance_sheet(ticker: Symbol, trade_date: Cutoff, freq: str = 'quarterly') -> str:
    """Read available balance sheets as of the analysis date."""
    return route_to_vendor('get_balance_sheet', ticker, freq, cutoff_date(trade_date))


@tool
def get_cashflow(ticker: Symbol, trade_date: Cutoff, freq: str = 'quarterly') -> str:
    """Read available cash flow statements as of the analysis date."""
    return route_to_vendor('get_cashflow', ticker, freq, cutoff_date(trade_date))


@tool
def get_income_statement(ticker: Symbol, trade_date: Cutoff, freq: str = 'quarterly') -> str:
    """Read available income statements as of the analysis date."""
    return route_to_vendor('get_income_statement', ticker, freq, cutoff_date(trade_date))


@tool
def get_insider_transactions(ticker: Symbol) -> str:
    """Read available insider transactions for the run's instrument."""
    return route_to_vendor('get_insider_transactions', ticker)


def analyst_tools(tools):
    from stockdepth.data.config import get_config
    if get_config().get('workflow_version', 1) < 3:
        return tools
    return [globals().get(t.name, t) for t in tools]
