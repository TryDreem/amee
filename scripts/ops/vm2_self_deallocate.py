#!/usr/bin/env python3
"""Self-deallocates this machine (VM#2, the transcribe/export worker) once no job has been
queued or processing for _IDLE_GRACE_SECONDS. Run periodically by
scripts/ops/systemd/amee-vm2-autodeallocate.timer - not a long-lived process, and not triggered
reactively from inside a Celery task. A periodic check with a grace period re-armed every time a
job is seen active is simpler to reason about than a purely reactive shutdown, and has a much
smaller race window: a task landing in the queue exactly as this fires just waits for VM#1's next
Start call (app/integrations/azure_vm.py) rather than being lost.

Deliberately a standalone script, not part of the FastAPI/Celery app (backend/app/): it has to
keep working even if that app is wedged or crash-looping, and self-shutdown has nothing to do
with request or job orchestration. It does reuse backend/app/db.py's engine setup, though - that
already resolves this project's `?ssl=require` Postgres DSN correctly (async driver selection,
NullPool), and there is no reason to re-solve that here.

Uses this VM's own system-assigned Managed Identity (reachable only from inside this VM, via the
Azure Instance Metadata Service) to call Deallocate on itself - no stored credential, and the
identity's role assignment is scoped to exactly this VM's own resource (least privilege). Its own
resource id is discovered from IMDS at run time, not hardcoded or configured.
"""

import asyncio
import logging
import sys
import time
from pathlib import Path

import httpx
from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.db import async_session_factory  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("vm2-autodeallocate")

_STATE_FILE = Path("/var/lib/amee/last-busy-at")
_IDLE_GRACE_SECONDS = 5 * 60
_IMDS_BASE = "http://169.254.169.254/metadata"
_ARM_API_VERSION = "2023-09-01"


async def _has_active_jobs() -> bool:
    async with async_session_factory() as session:
        result = await session.execute(
            text("SELECT count(*) FROM jobs WHERE status IN ('queued', 'processing')")
        )
        return bool(result.scalar_one())


async def _self_resource_id() -> str:
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(
            f"{_IMDS_BASE}/instance",
            headers={"Metadata": "true"},
            params={"api-version": "2021-02-01"},
        )
        response.raise_for_status()
        compute = response.json()["compute"]
    return (
        f"/subscriptions/{compute['subscriptionId']}"
        f"/resourceGroups/{compute['resourceGroupName']}"
        f"/providers/Microsoft.Compute/virtualMachines/{compute['name']}"
    )


async def _managed_identity_token() -> str:
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(
            f"{_IMDS_BASE}/identity/oauth2/token",
            headers={"Metadata": "true"},
            params={
                "api-version": "2018-02-01",
                "resource": "https://management.azure.com/",
            },
        )
        response.raise_for_status()
        return str(response.json()["access_token"])


async def _deallocate_self() -> None:
    resource_id = await _self_resource_id()
    token = await _managed_identity_token()
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"https://management.azure.com{resource_id}/deallocate",
            params={"api-version": _ARM_API_VERSION},
            headers={"Authorization": f"Bearer {token}"},
        )
        response.raise_for_status()


def _mark_busy_now() -> None:
    _STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    _STATE_FILE.write_text(str(time.time()))


async def main() -> None:
    if await _has_active_jobs():
        _mark_busy_now()
        logger.info("active job(s) in queue - staying up")
        return

    if not _STATE_FILE.exists():
        # First run ever (or state was cleared, e.g. a fresh deploy) - start the grace period
        # from now rather than deallocating on the very first check after booting.
        _mark_busy_now()
        logger.info("idle, no prior watermark - starting grace period now")
        return

    idle_since = float(_STATE_FILE.read_text().strip())
    idle_seconds = time.time() - idle_since
    if idle_seconds < _IDLE_GRACE_SECONDS:
        logger.info(
            "idle for %.0fs, waiting for the %ds grace period",
            idle_seconds,
            _IDLE_GRACE_SECONDS,
        )
        return

    # Recheck right before the irreversible call - narrows, doesn't eliminate, the race with a
    # task landing in the queue between the check above and this one. Acceptable at this
    # project's scale: a lost race just means the task waits in the queue for the next Start.
    if await _has_active_jobs():
        _mark_busy_now()
        logger.info("job appeared during recheck - staying up")
        return

    logger.info(
        "idle for %.0fs >= %ds grace period - deallocating",
        idle_seconds,
        _IDLE_GRACE_SECONDS,
    )
    await _deallocate_self()


if __name__ == "__main__":
    asyncio.run(main())
