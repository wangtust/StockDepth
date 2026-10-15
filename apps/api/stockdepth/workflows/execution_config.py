"""Freeze graph topology before the first billed call; preserve legacy resumes."""
import hashlib
import json
from pathlib import Path
from .analyst_execution import effective_analyst_concurrency


def execution_config(run_dir: Path, config: dict, analysts: list, *, resume=False, owner=None):
    path = run_dir / 'execution.json'
    owner_hash = hashlib.sha256(str(owner).encode()).hexdigest() if owner else None
    identity = {key: config.get(key) for key in ("analysis_ticker", "analysis_date", "realtime_data", "output_language", "max_debate_rounds", "max_risk_discuss_rounds")}
    if path.exists():
        saved = json.loads(path.read_text())
        if saved.get('analysts') != analysts or saved.get('owner') != owner_hash or saved.get('identity') != identity:
            raise ValueError('Execution identity/analyst selection differs from saved run')
    else:
        saved = {
            'workflow_version': 1 if resume else 2,
            'analyst_concurrency_limit': 1 if resume else effective_analyst_concurrency(config),
            'max_tool_rounds': config.get('max_tool_rounds', 5),
            'analysts': analysts, 'owner': owner_hash, 'identity': identity,
        }
        temp = path.with_suffix('.tmp')
        temp.write_text(json.dumps(saved, indent=2))
        temp.replace(path)
    if saved['workflow_version'] not in (1, 2):
        raise ValueError('Unsupported saved workflow version')
    return saved
