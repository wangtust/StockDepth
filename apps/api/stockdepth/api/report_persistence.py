"""Runner-local caches; disk files remain the recovery source of truth."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import json
import tempfile
import contextlib
from stockdepth.api.timing import CURRENT_TIMING


def signature(path: Path):
    try:
        stat = path.stat()
        return stat.st_mtime_ns, stat.st_size, stat.st_ino
    except FileNotFoundError:
        return None


def _complete_content(content: str) -> str:
    """Exclude only the builder's header timestamp, preserving all other bytes."""
    lines = content.splitlines(keepends=True)
    if (len(lines) >= 3 and lines[0].startswith('# Trading Analysis Report: ')
            and not lines[1].strip() and lines[2].startswith('Generated: ')):
        del lines[2]
    return ''.join(lines)


class ReportPersistence:
    def __init__(self):
        self.texts = {}
        self.snapshots = {}
        self.histories = {}

    def write(self, path: Path, content: str) -> bool:
        recorder = CURRENT_TIMING.get()
        measurement = recorder.measure('report_write', path.name, lambda: path.stat().st_size) if recorder else contextlib.nullcontext()
        with measurement:
            return self._write(path, content)

    def _write(self, path: Path, content: str) -> bool:
        stamp = signature(path)
        cached = self.texts.get(path)
        if cached and cached == (stamp, content) and stamp is not None:
            return False
        if stamp is not None and path.read_text(encoding='utf-8') == content:
            self.texts[path] = (stamp, content)
            return False
        path.parent.mkdir(parents=True, exist_ok=True)
        # Unique temporary names avoid colliding with a stale interrupted write.
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.name + '.', suffix='.tmp', delete=False) as file:
                temporary = Path(file.name)
                file.write(content.encode('utf-8'))
            temporary.replace(path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        self.texts[path] = (signature(path), content)
        return True

    def save_state(self, payload: dict, path: Path):
        cached = self.snapshots.get(path)
        if cached and cached[0] == signature(path) and cached[1] == payload:
            return
        self.write(path, json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        self.snapshots[path] = (signature(path), deepcopy(payload))

    def save_complete(self, state: dict, path: Path, ticker: str, builder):
        keys = ('market_report', 'sentiment_report', 'news_report', 'fundamentals_report',
                'investment_plan', 'trader_investment_plan', 'final_trade_decision',
                'investment_debate_state', 'risk_debate_state',
                'research_status', 'decision_rating', 'decision_validation')
        payload = {key: state.get(key) for key in keys}
        cached = self.snapshots.get(path)
        if cached and cached[0] == signature(path) and cached[1] == (ticker, payload):
            return
        content = builder(state, ticker)
        # Generated time is metadata, not a report change; retain it on recovery.
        if path.exists():
            previous = path.read_text(encoding='utf-8')
            if _complete_content(previous) == _complete_content(content):
                content = previous
        self.write(path, content)
        self.snapshots[path] = (signature(path), deepcopy((ticker, payload)))
