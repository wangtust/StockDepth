import asyncio
import multiprocessing
import time

import pytest

from stockdepth.providers.rate_limit import ProviderRateLimiter, provider_runtime_options


def reserve(directory, queue):
    limiter = ProviderRateLimiter("test", "endpoint", 600, directory)
    limiter.acquire()
    queue.put(time.time())


def test_independent_runners_share_request_limit(tmp_path):
    ctx = multiprocessing.get_context("fork")
    queue = ctx.Queue()
    workers = [ctx.Process(target=reserve, args=(str(tmp_path), queue)) for _ in range(4)]
    for worker in workers:
        worker.start()
    times = sorted(queue.get(timeout=5) for _ in workers)
    for worker in workers:
        worker.join(timeout=5)
        assert worker.exitcode == 0
    assert times[-1] - times[0] >= 0.28


def test_nonblocking_and_provider_isolation(tmp_path):
    limiter = ProviderRateLimiter("test", "endpoint", 60, tmp_path)
    assert limiter.acquire(blocking=False)
    assert not limiter.acquire(blocking=False)
    assert ProviderRateLimiter("other", "endpoint", 60, tmp_path).acquire(blocking=False)
    assert not asyncio.run(limiter.aacquire(blocking=False))


def test_configuration_and_validation(tmp_path, monkeypatch):
    monkeypatch.setenv("STOCKDEPTH_RATE_LIMIT_DIR", str(tmp_path))
    monkeypatch.setenv("STOCKDEPTH_PROVIDER_DEEPSEEK_RPM", "30")
    assert provider_runtime_options("deepseek")["rate_limiter"].interval == 2
    monkeypatch.setenv("STOCKDEPTH_MODEL_MAX_RETRIES", "6")
    with pytest.raises(ValueError):
        provider_runtime_options("deepseek")
    for invalid in (0, -1, float("nan"), float("inf")):
        with pytest.raises(ValueError):
            ProviderRateLimiter("test", "endpoint", invalid, tmp_path)
