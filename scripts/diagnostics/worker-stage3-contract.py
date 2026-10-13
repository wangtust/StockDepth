"""Independent read-only contract verification: no graph/model/DB execution."""
import json
import runpy
from pathlib import Path
root = Path(__file__).resolve().parents[2]
contract = json.loads((root / 'var/codex-performance-team/stage3-contract.json').read_text())
assert contract['ready'] and contract['schema_version'] == 1
execution = contract['execution']
assert execution['default_concurrency'] == 1
assert execution['api_change'] is False
assert 'no host-wide' in execution['cross_run_bound']
limit = runpy.run_path(str(root / 'apps/api/stockdepth/workflows/analyst_execution.py'))['effective_analyst_concurrency']
assert limit({}) == 1
assert limit({'analyst_concurrency_limit': 2}) == 2
for cap, expected in [(1, 1), (2, 2), (4, 2)]:
    assert limit({'analyst_concurrency_limit': 2, 'model_configs': {'quick': {'options': {'request_concurrency': cap}}}}) == expected
assert limit({'analyst_concurrency_limit': 2, 'model_configs': {'quick': {}}}) == 1
print('PASS current Python contract, default serial, explicit opt-in, quick snapshot clamp 1/2/4 and legacy missing options fallback; no request or graph execution')
