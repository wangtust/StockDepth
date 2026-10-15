"""Validate analyst tool identities and cutoff dates before executing tools."""
from datetime import date
from langchain_core.messages import ToolMessage
from langchain_core.runnables import RunnableLambda


def guarded_tools(tools):
    def run(state, config):
        calls = state['messages'][-1].tool_calls
        expected = state['company_of_interest'].strip().upper()
        cutoff = date.fromisoformat(state['trade_date'])
        from stockdepth.data.config import get_config
        realtime = get_config().get('realtime_data', False)
        errors = {}
        for call in calls:
            args = call.get('args') or {}
            reason = None
            for key in ('ticker', 'symbol'):
                if key in args and str(args[key]).strip().upper() != expected:
                    reason = 'Instrument does not match the requested exchange-qualified ticker.'
            try:
                dates = {key: date.fromisoformat(str(args[key])) for key in ('curr_date', 'start_date', 'end_date') if args.get(key)}
                if not realtime and any(value > cutoff for value in dates.values()):
                    reason = 'Requested data date exceeds the analysis cutoff.'
                if 'start_date' in dates and 'end_date' in dates and dates['start_date'] > dates['end_date']:
                    reason = 'Start date exceeds end date.'
            except ValueError:
                reason = 'Invalid date; use YYYY-MM-DD.'
            if reason:
                errors[call['id']] = reason
        if not errors:
            return tools.invoke(state, config)
        # Execute valid calls only; return a matching ToolMessage for each
        # rejected request so the model can correct it within its turn budget.
        valid = [c for c in calls if c['id'] not in errors]
        private = {**state, "messages": [*state["messages"][:-1], state["messages"][-1].model_copy(update={"tool_calls": valid})]}
        result = tools.invoke(private, config)["messages"] if valid else []
        return {'messages': [*result, *(ToolMessage(content='[DATA QUALITY] ' + reason, tool_call_id=identity) for identity, reason in errors.items())]}
    return RunnableLambda(run)
