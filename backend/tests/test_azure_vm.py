"""app/integrations/azure_vm.py - VM#1's side of auto Start/Deallocate: starting VM#2 via its own
system-assigned Managed Identity (Azure Instance Metadata Service token, no stored secret) right
after a transcribe/export task is enqueued. VM#2's own self-deallocate side is a standalone
systemd-timer script (scripts/ops/vm2_self_deallocate.py), not part of this app - out of scope for
these tests.
"""

import asyncio
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import patch

import httpx
import pytest

from app.integrations import azure_vm

_RESOURCE_ID = "/subscriptions/sub-1/resourceGroups/amee-prod/providers/Microsoft.Compute/virtualMachines/amee-prod-vm2"


@contextmanager
def _mocked_transport(
    handler: Callable[[httpx.Request], httpx.Response],
) -> Iterator[None]:
    """Same convention as tests/test_google_oauth.py - azure_vm.py builds its own inline
    httpx.AsyncClient() per call (no injectable client parameter), so tests globally patch
    AsyncClient.__init__ to swap in a MockTransport rather than hitting the real network."""
    original_init = httpx.AsyncClient.__init__

    def patched_init(self: httpx.AsyncClient, *args: Any, **kwargs: Any) -> None:
        kwargs["transport"] = httpx.MockTransport(handler)
        original_init(self, *args, **kwargs)

    with patch.object(httpx.AsyncClient, "__init__", patched_init):
        yield


async def test_no_op_and_no_network_call_when_vm2_resource_id_is_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("AMEE_VM2_RESOURCE_ID", raising=False)
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={})

    with _mocked_transport(handler):
        await azure_vm.ensure_vm2_running()

    assert called is False


async def test_fetches_a_token_then_posts_start_with_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AMEE_VM2_RESOURCE_ID", _RESOURCE_ID)
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if "identity/oauth2/token" in request.url.path:
            assert request.headers["Metadata"] == "true"
            assert request.url.params["resource"] == "https://management.azure.com/"
            return httpx.Response(200, json={"access_token": "mi-token-123"})
        return httpx.Response(200, json={})

    with _mocked_transport(handler):
        await azure_vm.ensure_vm2_running()

    assert len(seen) == 2
    start_request = seen[1]
    assert start_request.method == "POST"
    assert start_request.url.path == f"{_RESOURCE_ID}/start"
    assert start_request.headers["Authorization"] == "Bearer mi-token-123"


async def test_swallows_a_token_fetch_failure_without_raising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AMEE_VM2_RESOURCE_ID", _RESOURCE_ID)

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("IMDS unreachable")

    with _mocked_transport(handler):
        await azure_vm.ensure_vm2_running()  # must not raise


async def test_swallows_a_non_200_start_response_without_raising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AMEE_VM2_RESOURCE_ID", _RESOURCE_ID)

    def handler(request: httpx.Request) -> httpx.Response:
        if "identity/oauth2/token" in request.url.path:
            return httpx.Response(200, json={"access_token": "t"})
        return httpx.Response(403, json={"error": "Forbidden"})

    with _mocked_transport(handler):
        await azure_vm.ensure_vm2_running()  # must not raise


async def test_fire_and_forget_runs_the_coroutine_without_being_awaited() -> None:
    done = asyncio.Event()

    async def work() -> None:
        done.set()

    azure_vm.fire_and_forget(work())
    await asyncio.wait_for(done.wait(), timeout=1.0)
