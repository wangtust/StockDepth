"""Deterministic cross-second recovery acceptance; no models or database."""
import datetime
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
from stockdepth.api import analysis_runner as runner

with tempfile.TemporaryDirectory(prefix="stockdepth-coordinator-stage2-recovery-") as directory:
    path = Path(directory) / "complete_report.md"
    state = {"market_report": "unchanged mock report"}
    first_time = datetime.datetime(2026, 10, 13, 0, 0, 0)
    later_time = datetime.datetime(2026, 10, 13, 0, 1, 0)
    with patch.object(runner.dt, "datetime") as clock:
        clock.now.return_value = first_time
        cache = runner.ReportPersistence()
        cache.save_complete(state, path, "MOCK", runner.build_complete_report)
        before = path.read_text()
        stamp = path.stat().st_mtime_ns
        clock.now.return_value = later_time
        cache.save_complete(state, path, "MOCK", runner.build_complete_report)
        assert path.read_text() == before, "same-process unchanged report"
        runner.ReportPersistence().save_complete(state, path, "MOCK", runner.build_complete_report)
        after = path.read_text()
        result = {"scenario": "new persistence instance, unchanged state, Generated advances 60 seconds",
                  "before": before, "after": after,
                  "content_equal": before == after, "mtime_equal": stamp == path.stat().st_mtime_ns}
        print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
        assert before == after and stamp == path.stat().st_mtime_ns, "Recovery rewrites unchanged complete report when Generated time changes"
