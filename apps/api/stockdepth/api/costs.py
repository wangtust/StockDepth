"""Estimate CNY costs using immutable per-call prices and reported cache usage."""
from decimal import Decimal, InvalidOperation


def cached_tokens(usage):
    for key in ('prompt_cache_hit_tokens', 'cache_read_input_tokens', 'cached_tokens'):
        if key in usage:
            return usage[key]
    for key in ('prompt_tokens_details', 'input_token_details', 'input_tokens_details'):
        details = usage.get(key) or {}
        for field in ('cached_tokens', 'cache_read'):
            if field in details:
                return details[field]
    return None


def estimate_cost(inp, out, cached, prices, usage=None):
    unknown = {'estimated_cost': None, 'cost_complete': False}
    if inp is None or out is None or not prices:
        return unknown
    # Explicit cache writes need a separate tariff, unsupported by the three-price form.
    usage = usage or {}
    if usage.get('cache_creation_input_tokens') or (usage.get('input_token_details') or {}).get('cache_creation'):
        return unknown
    try:
        rates = [Decimal(str(prices[k])) for k in ('input', 'cache', 'output')]
        if any(not rate.is_finite() or rate < 0 for rate in rates):
            return unknown
    except (KeyError, InvalidOperation, TypeError):
        return unknown
    valid_cache = isinstance(cached, int) and not isinstance(cached, bool) and 0 <= cached <= inp
    if cached is not None and not valid_cache:
        return unknown
    hit = cached if valid_cache else 0
    cost = ((inp - hit) * rates[0] + hit * rates[1] + out * rates[2]) / Decimal(1_000_000)
    return {'estimated_cost': format(cost.quantize(Decimal('0.000000000001')), 'f'),
            'cost_complete': valid_cache or rates[0] == rates[1]}
