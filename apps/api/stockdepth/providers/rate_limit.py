"""A host-wide provider request gate shared by independent analysis runners.

The lock is held only while reserving a slot. No prompts or API keys are stored.
SDKs retain responsibility for bounded transient retries and exponential backoff.
"""
import asyncio
import fcntl
import hashlib
import math
import os
from pathlib import Path
import tempfile
import time

from langchain_core.rate_limiters import BaseRateLimiter


class ProviderRateLimiter(BaseRateLimiter):
    def __init__(self, provider: str, endpoint: str, rpm: float, directory=None, bucket_id=None):
        if not math.isfinite(rpm) or rpm <= 0:
            raise ValueError("Provider RPM must be positive and finite")
        self.interval = 60 / rpm
        root = Path(directory or os.getenv("STOCKDEPTH_RATE_LIMIT_DIR") or
                    Path(tempfile.gettempdir()) / f"stockdepth-rate-limits-{os.getuid()}")
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        key = hashlib.sha256(f"{provider}:{endpoint.rstrip('/')}:{bucket_id or ''}".encode()).hexdigest()
        self.path = root / key

    def acquire(self, *, blocking=True):
        while True:
            with self.path.open("a+") as state:
                fcntl.flock(state, fcntl.LOCK_EX)
                state.seek(0)
                text = state.read()
                try:
                    next_at = float(text) if text else 0
                except ValueError:
                    next_at = 0
                now = time.time()
                delay = max(0, next_at - now)
                if delay == 0:
                    state.seek(0)
                    state.truncate()
                    state.write(str(now + self.interval))
                    state.flush()
                    return True
            if not blocking:
                return False
            time.sleep(min(delay, 1))

    async def aacquire(self, *, blocking=True):
        # Cancellation does not leave a blocking background thread reserving slots.
        while not self.acquire(blocking=False):
            if not blocking:
                return False
            await asyncio.sleep(min(self.interval, 0.1))
        return True


def provider_runtime_options(provider, endpoint=None, rpm_override=None, bucket_id=None):
    key = provider.upper().replace("-", "_")
    rpm = float(rpm_override or os.getenv(f"STOCKDEPTH_PROVIDER_{key}_RPM", os.getenv("STOCKDEPTH_PROVIDER_RPM", "60")))
    retries = int(os.getenv("STOCKDEPTH_MODEL_MAX_RETRIES", "2"))
    if not 0 <= retries <= 5:
        raise ValueError("Model retries must be between 0 and 5")
    return {"rate_limiter": ProviderRateLimiter(provider, endpoint or "default", rpm, bucket_id=bucket_id), "max_retries": retries}
