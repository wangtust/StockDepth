"""Shared 5-tier rating vocabulary and a deterministic heuristic parser.

The same five-tier scale (Buy, Overweight, Hold, Underweight, Sell) is used by:
- The Research Manager (investment plan recommendation)
- The Portfolio Manager (final position decision)
- The signal processor (rating extracted for downstream consumers)
- The memory log (rating tag stored alongside each decision entry)

Centralising it here avoids drift between those call sites.
"""

from __future__ import annotations

import re
from typing import Tuple


# Canonical, ordered 5-tier scale (most bullish to most bearish).
RATINGS_5_TIER: Tuple[str, ...] = (
    "Buy", "Overweight", "Hold", "Underweight", "Sell",
)

_RATING_SET = {r.lower() for r in RATINGS_5_TIER}

# Matches "Rating: X" / "rating - X" / "Rating: **X**" — tolerates markdown
# bold wrappers and either a colon or hyphen separator.
_RATING_LABEL_RE = re.compile(r"^\s*(?:#{1,6}\s*)?(?:\d+[.)]\s*)?[*_]*(?:Rating|评级|最终评级)[*_]*\s*[:：\-]\s*(.+?)\s*$", re.IGNORECASE)


def parse_rating(text: str, default: str = "REVIEW") -> str:
    """Heuristically extract a 5-tier rating from prose text.

    Accept an explicit rating label or a standalone rating. Invalid or
    conflicting labels and prose-only mentions return ``default`` (REVIEW).
    """
    if not isinstance(text, str):
        return default
    labels = []
    for line in text.splitlines():
        m = _RATING_LABEL_RE.search(line)
        if m:
            value = m.group(1).strip().strip("*_. ").lower()
            if value not in _RATING_SET:
                return default
            labels.append(value.capitalize())
    if labels:
        return labels[0] if len(set(labels)) == 1 else default
    # Legacy callers may supply only the rating. Prose mentions are not a
    # decision: e.g. "buy thesis rejected" must never become Buy.
    bare = text.strip().strip("* .").lower()
    return bare.capitalize() if bare in _RATING_SET else default
