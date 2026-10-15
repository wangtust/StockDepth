"""Shared evidence boundaries for research and decision agents."""
from stockdepth.agents.utils.agent_utils import build_instrument_context

NO_EXTERNAL_TOOLS = 'You have no external tools in this role. Use only supplied evidence; state uncertainty and never invent retrieved data.'


def report_or_absent(text, source):
    return text.strip() if isinstance(text, str) and text.strip() else f'[REPORT NOT PROVIDED] {source}: no report was provided; this is not a neutral finding.'


def opponent_argument_or_opening(text, opponent):
    return text.strip() if text and text.strip() else f'[{opponent} has not spoken yet. Open with your own evidence; do not invent an opposing argument.]'


def instrument_context(state):
    return state.get('instrument_context') or build_instrument_context(state['company_of_interest'], state.get('asset_type', 'stock'))


def portfolio_context(state):
    return state.get('portfolio_context') or 'Portfolio not provided. Holdings and cash are unknown; do not assume an empty account or invent an executable quantity.'


def decision_context(state):
    return '\n\n'.join([instrument_context(state), portfolio_context(state),
        state.get('market_evidence') or '[MARKET EVIDENCE UNAVAILABLE] Do not invent exact price levels.', NO_EXTERNAL_TOOLS])
