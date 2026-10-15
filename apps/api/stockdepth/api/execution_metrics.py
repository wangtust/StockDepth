"""Comparable run metrics derived from authoritative per-call usage snapshots."""
import json
from decimal import Decimal
from pathlib import Path
from stockdepth.api.usage import read_usage


def save_execution_metrics(run_dir: Path, frozen, elapsed_seconds, succeeded, persistence):
    path = run_dir / 'execution_metrics.json'
    previous = json.loads(path.read_text()) if path.exists() else {'attempts': []}
    attempts = [*previous['attempts'], {'elapsed_seconds': round(elapsed_seconds, 6), 'succeeded': succeeded}]
    usage = read_usage(run_dir / 'usage.json')
    calls = usage['calls']
    failed = sum(c['status'] in ('failed', 'interrupted') for c in calls)
    cost = sum((Decimal(c['estimated_cost']) for c in calls if c.get('estimated_cost') is not None), Decimal(0))
    summary = {
        'workflow_version': frozen['workflow_version'],
        'analyst_concurrency': frozen['analyst_concurrency_limit'],
        'max_tool_rounds': frozen['max_tool_rounds'],
        'attempts': attempts, 'elapsed_seconds': sum(a['elapsed_seconds'] for a in attempts),
        'succeeded': succeeded, 'model_calls': len(calls), 'failed_calls': failed,
        'failure_rate': failed / len(calls) if calls else None,
        'known_total_tokens': sum(c.get('total_tokens') or 0 for c in calls),
        'tokens_complete': usage['history_complete'] and all(c.get('usage_available') for c in calls),
        'known_cost': str(cost), 'cost_currency': 'CNY',
        'cost_complete': usage['history_complete'] and all(c.get('cost_complete') for c in calls),
    }
    persistence.write(path, json.dumps(summary, indent=2))
    public = {k: v for k, v in summary.items() if k != 'attempts'}
    persistence.write(run_dir / 'reports' / 'execution_summary.md',
                      '# Execution Metrics\n\n```json\n' + json.dumps(public, indent=2) + '\n```\n\n'
                      'Known tokens and cost are partial when their completeness flag is false. '
                      'Cost uses each call’s saved price snapshot. Elapsed time includes all runner attempts; '
                      'it excludes time in the Worker job queue.\n')
    return summary
