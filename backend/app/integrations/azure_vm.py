import asyncio
import logging
import os
from collections.abc import Coroutine
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Azure Instance Metadata Service - reachable from inside any Azure VM, no network config needed.
# Returns a token for this VM's own system-assigned Managed Identity; no secret is stored anywhere
# to get one (arch: VM#1/VM#2 auto Start/Deallocate, Managed Identity not a stored credential).
_IMDS_TOKEN_URL = "http://169.254.169.254/metadata/identity/oauth2/token"
_ARM_RESOURCE = "https://management.azure.com/"
_ARM_API_VERSION = "2023-09-01"

# Tasks handed to fire_and_forget() below - held here only so asyncio doesn't garbage-collect a
# task nothing else references before it finishes (a documented asyncio gotcha, not hypothetical).
_background_tasks: set[asyncio.Task[None]] = set()


def fire_and_forget(coro: Coroutine[Any, Any, None]) -> None:
    """Schedules `coro` without awaiting it and without needing a Request/Response object (A1 -
    services never see those), so a slow or failing Azure API call never adds latency to, or fails,
    the request that triggered it."""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def _managed_identity_token() -> str:
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(
            _IMDS_TOKEN_URL,
            headers={"Metadata": "true"},
            params={"api-version": "2018-02-01", "resource": _ARM_RESOURCE},
        )
        response.raise_for_status()
        return str(response.json()["access_token"])


async def ensure_vm2_running() -> None:
    """Starts VM#2 via VM#1's own system-assigned Managed Identity, whose role assignment is
    scoped to exactly VM#2's resource (least privilege - it cannot touch anything else in the
    subscription). Meant to be called through fire_and_forget() right after enqueueing a
    transcribe/export/export-srt task (services/transcribe.py, services/export.py), so VM#2 is
    booting in parallel with the message already waiting in the queue.

    No-op if AMEE_VM2_RESOURCE_ID isn't set - dev/CI and any single-VM deployment have no second
    VM to start. Starting an already-running (or already-starting) VM is a documented Azure
    no-op, so this never needs its own "is it already up" check first. Errors are logged and
    swallowed, never raised - a transient Azure API hiccup must not fail the user's
    transcribe/export request; worst case, VM#2 was already running anyway, or the next task's
    own call succeeds instead."""
    resource_id = os.environ.get("AMEE_VM2_RESOURCE_ID")
    if not resource_id:
        return
    try:
        token = await _managed_identity_token()
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{_ARM_RESOURCE.rstrip('/')}{resource_id}/start",
                params={"api-version": _ARM_API_VERSION},
                headers={"Authorization": f"Bearer {token}"},
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("failed to start VM#2 via Managed Identity: %s", exc)
