"""Shared pytest fixtures that prevent CI hangs when API keys are absent."""

import os
import ipaddress
import socket
from unittest.mock import MagicMock, patch

import pytest


def pytest_configure(config):
    for marker in ("unit", "integration", "smoke"):
        config.addinivalue_line("markers", f"{marker}: {marker}-level tests")


_API_KEY_ENV_VARS = (
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "ANTHROPIC_API_KEY",
    "XAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "DASHSCOPE_API_KEY",
    "DASHSCOPE_CN_API_KEY",
    "ZHIPU_API_KEY",
    "ZHIPU_CN_API_KEY",
    "MINIMAX_API_KEY",
    "MINIMAX_CN_API_KEY",
    "OPENROUTER_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "ALPHA_VANTAGE_API_KEY",
)


@pytest.fixture(autouse=True)
def _dummy_api_keys(monkeypatch):
    for env_var in _API_KEY_ENV_VARS:
        monkeypatch.setenv(env_var, "placeholder" if os.environ.get('STOCKDEPTH_TEST_OFFLINE') == '1'
                           else os.environ.get(env_var, "placeholder"))


@pytest.fixture(autouse=True)
def _offline_network(monkeypatch):
    if os.environ.get('STOCKDEPTH_TEST_OFFLINE') != '1':
        return
    connect, connect_ex = socket.socket.connect, socket.socket.connect_ex
    bind = socket.socket.bind
    bound_ports = set()

    def guarded_bind(self, address):
        if isinstance(address, tuple) and not ipaddress.ip_address(address[0]).is_loopback:
            raise AssertionError('Offline fixtures must bind loopback')
        result = bind(self, address)
        if isinstance(address, tuple):
            bound_ports.add(self.getsockname()[1])
        return result

    def check(address):
        if isinstance(address, tuple):
            # Only loopback synthetic HTTP fixtures; never resolve external hosts.
            host = address[0]
            try:
                allowed = ipaddress.ip_address(host).is_loopback
            except ValueError:
                allowed = host == 'localhost'
            if not allowed or address[1] not in bound_ports:
                raise AssertionError(f'Offline test attempted connection outside its synthetic fixture: {address}')

    def guarded(self, address):
        check(address)
        return connect(self, address)

    def guarded_ex(self, address):
        check(address)
        return connect_ex(self, address)

    monkeypatch.setattr(socket.socket, 'connect', guarded)
    monkeypatch.setattr(socket.socket, 'connect_ex', guarded_ex)
    monkeypatch.setattr(socket.socket, 'bind', guarded_bind)


@pytest.fixture()
def mock_llm_client():
    client = MagicMock()
    client.get_llm.return_value = MagicMock()
    with patch(
        "stockdepth.providers.factory.create_llm_client",
        return_value=client,
    ):
        yield client
