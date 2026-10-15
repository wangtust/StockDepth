"""Compare 1/2/4 production graph topologies with deterministic local fixtures.

No providers, credentials, network, or project database. Usage and cost figures
are synthetic snapshots, not a claim about real model savings.
"""
import argparse
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import statistics
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'apps/api'))
sys.path.insert(0, str(ROOT / 'apps/api/tests'))
from test_stage3_python import MockModel, mock_workflow, initial
from stockdepth.api.usage import UsageRecorder, read_usage
from langgraph.checkpoint.sqlite import SqliteSaver


def run(trials):
    groups = []
    hashes = set()
    for concurrency in (1, 2, 4):
        rows = []
        for trial in range(trials):
            with tempfile.TemporaryDirectory(prefix='stockdepth-benchmark-') as directory:
                model = MockModel(delay=.05)
                recorder = UsageRecorder(Path(directory) / 'usage.json')
                bound = model.with_config(metadata={'model_role': 'quick', 'model_config_id': 1,
                    'model_provider': 'local-mock', 'model_name': 'fixture',
                    'pricing_snapshot': {'input': '1.25', 'cache': '1.25', 'output': '2.50', 'currency': 'CNY'}})
                graph = mock_workflow(concurrency, bound, workflow_version=2).compile()
                begin = time.perf_counter()
                result = graph.invoke(initial(), {'callbacks': [recorder]})
                elapsed = time.perf_counter() - begin
                calls = read_usage(Path(directory) / 'usage.json')['calls']
                reports = {k: v for k, v in result.items() if k.endswith('_report') or k == 'final_trade_decision'}
                digest = hashlib.sha256(json.dumps(reports, sort_keys=True).encode()).hexdigest()
                hashes.add(digest)
                rows.append({'elapsed_seconds': elapsed, 'peak_model_requests': model._peak,
                    'model_calls': len(calls), 'tokens': sum(c['total_tokens'] for c in calls),
                    'synthetic_cost_cny': str(sum((Decimal(c['estimated_cost']) for c in calls), Decimal(0))),
                    'failed_calls': sum(c['status'] != 'complete' for c in calls), 'result_sha256': digest})
        # One deliberate interruption per topology. The completed market branch
        # and news tool request must not be invoked again on recovery.
        with tempfile.TemporaryDirectory(prefix='stockdepth-recovery-') as directory:
            broken = MockModel(); broken._fail.add('news')
            cfg = {'configurable': {'thread_id': 'fault'}}
            interrupted = False
            with SqliteSaver.from_conn_string(str(Path(directory) / 'checkpoint.db')) as saver:
                try:
                    mock_workflow(concurrency, broken, workflow_version=2).compile(checkpointer=saver).invoke(initial(), cfg)
                except RuntimeError:
                    interrupted = True
            recovered = MockModel()
            with SqliteSaver.from_conn_string(str(Path(directory) / 'checkpoint.db')) as saver:
                mock_workflow(concurrency, recovered, workflow_version=2).compile(checkpointer=saver).invoke(None, cfg)
            assert interrupted and recovered._calls['market'] == 0 and recovered._calls['news'] == 1
        groups.append({'concurrency': concurrency, 'median_seconds': statistics.median(r['elapsed_seconds'] for r in rows),
                       'successful_trials': trials, 'failed_trials': 0, 'fault_recovery_passed': True, 'trials': rows})
    assert len(hashes) == 1, 'Serial and parallel report content must match'
    baseline = groups[0]['median_seconds']
    for group in groups:
        group['speedup'] = baseline / group['median_seconds']
    return {'scope': 'Offline deterministic fixture: 50ms per model call, synthetic tokens/prices, no production performance claim.', 'groups': groups}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--trials', type=int, default=5)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.trials < 1:
        parser.error('--trials must be positive')
    result = run(args.trials)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2))
    for group in result['groups']:
        print(json.dumps({k: v for k, v in group.items() if k != 'trials'}))
