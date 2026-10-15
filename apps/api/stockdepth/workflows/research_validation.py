"""Deterministic report barrier and final decision validation."""
from stockdepth.agents.utils.rating import parse_rating

MISSING_REPORT = "[MISSING RESEARCH REPORT]"


def report_barrier(plan):
    def validate(state):
        updates = {}
        status = {}
        for spec in plan.specs:
            report = state.get(spec.report_key)
            missing = not isinstance(report, str) or not report.strip()
            if missing:
                report = f"{MISSING_REPORT} {spec.agent_node}: no usable report was produced."
                updates[spec.report_key] = report
            status[spec.key] = "missing" if missing or report.startswith(MISSING_REPORT) else "complete"
        return {**updates, "research_status": status}
    return validate


def validate_decision(state):
    rating = parse_rating(state.get("final_trade_decision", ""))
    reasons = []
    if rating == "REVIEW":
        reasons.append("Final rating is missing, invalid or conflicting.")
    if "missing" in (state.get("research_status") or {}).values():
        rating = "REVIEW"
        reasons.append("Selected research reports are incomplete.")
    if 'market_snapshot' in state:
        import re
        import math
        prices = {}
        for label, raw in re.findall(r'^\s*\*?\*?(Entry Price|Stop Loss)\*?\*?\s*:\s*([^\n]+)', state.get('trader_investment_plan', ''), re.MULTILINE | re.IGNORECASE):
            try:
                value = float(raw.strip().replace(',', ''))
                if not math.isfinite(value) or value <= 0:
                    raise ValueError('invalid price')
                prices[label.lower()] = value
            except ValueError:
                reasons.append(f'{label} must be one positive absolute price, not a percentage or range.')
        if prices and not state.get('market_snapshot'):
            reasons.append('Trader proposed numeric prices without verified market evidence.')
        action = re.search(r'\*?\*?Action\*?\*?\s*:\s*(Buy|Hold|Sell)', state.get('trader_investment_plan', ''), re.IGNORECASE)
        if action and action.group(1).lower() == 'buy' and 'entry price' in prices and 'stop loss' in prices and prices['stop loss'] >= prices['entry price']:
            reasons.append('Long-entry stop loss must be below the entry price.')
        if reasons:
            rating = 'REVIEW'
    updates = {"decision_rating": rating, "decision_validation": reasons}
    if reasons:
        # This header is also consumed by the SaaS decision extractor. REVIEW
        # cannot be turned into a trade by an incidental buy/hold/sell mention.
        updates["final_trade_decision"] = (
            "**Rating**: REVIEW\n\n" + " ".join(reasons)
            + "\n\nOriginal portfolio assessment:\n\n" + state.get("final_trade_decision", "")
        )
    return updates
