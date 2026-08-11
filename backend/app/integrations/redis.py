import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from redis import asyncio as redis

# job_id-scoped keys, not hashes - each field has its own writer/reader with
# its own timing (progress: every ffmpeg tick; pid: once at spawn; cancel
# flag: once from the cancel endpoint), so there's no natural moment all
# three of one job's fields would be read/written together as a unit.
_PROGRESS_KEY = "job:{job_id}:progress_percent"
_PID_KEY = "job:{job_id}:ffmpeg_pid"
_CANCEL_KEY = "job:{job_id}:cancel_requested"

# Bounds the blast radius of a leaked key if a task ever crashes between
# writing this and clearing it on completion/failure/cancellation - matches
# INVARIANTS A3/A5: Redis is never a source of truth, so a value quietly
# expiring just means "no progress shown" / "can't be cancelled anymore",
# never a stuck or wrong Job row. Comfortably above any export this app
# expects to run (contract has no fixed duration cap, but an hour-long
# render is already an extreme outlier for burned-in captions).
_KEY_TTL_SECONDS = 4 * 60 * 60


@asynccontextmanager
async def _client() -> AsyncIterator[redis.Redis]:
    """A fresh client per call, not a cached module-level singleton - same
    reasoning as `app/db.py`'s `NullPool` on the Postgres engine: a pooled
    async connection is bound to the event loop it was opened on, and
    Celery tasks in this codebase each get a fresh loop via `asyncio.run()`
    (arch §2.2). A singleton created under task A's loop raises "attached
    to a different loop" the moment task B's loop tries to reuse it - this
    bit during manual testing of this exact module. Closing on exit (`async
    with`) releases the connection instead of leaking one per call.

    Unlike `app/db.py`'s `AMEE_DB_URL` (which fails loud on a missing env
    var, because Postgres is the source of truth), a missing
    `AMEE_REDIS_URL` is treated as just another way Redis can be
    unavailable (A3) - every caller below already catches this alongside
    `RedisError`, so "never configured" degrades the same as "configured
    but down", never a crash."""
    client = redis.from_url(os.environ["AMEE_REDIS_URL"], decode_responses=True)
    try:
        yield client
    finally:
        await client.aclose()


async def _set(key: str, value: str | float) -> None:
    """Best-effort by design (A3/A5): callers must not let a Redis failure
    here fail the export itself."""
    try:
        async with _client() as client:
            await client.set(key, value, ex=_KEY_TTL_SECONDS)
    except (KeyError, redis.RedisError):
        pass


async def _get(key: str) -> str | None:
    """`None` covers every indistinguishable-by-design case (A3): the value
    was never set, Redis is unavailable, or it was never configured."""
    try:
        async with _client() as client:
            value = await client.get(key)
    except (KeyError, redis.RedisError):
        return None
    return str(value) if value is not None else None


async def _delete(key: str) -> None:
    try:
        async with _client() as client:
            await client.delete(key)
    except (KeyError, redis.RedisError):
        pass


async def set_export_progress(job_id: str, percent: float) -> None:
    """Written on every ffmpeg `-progress` tick, read on every `GET
    /jobs/{id}` poll while an export is `processing` (contract §5)."""
    await _set(_PROGRESS_KEY.format(job_id=job_id), percent)


async def get_export_progress(job_id: str) -> float | None:
    raw = await _get(_PROGRESS_KEY.format(job_id=job_id))
    return float(raw) if raw is not None else None


async def clear_export_progress(job_id: str) -> None:
    """Called once the export task reaches a terminal state - the TTL would
    clean this up eventually regardless, but an explicit clear means a
    fast-finishing export doesn't leave a stale 100%-minus-epsilon value
    sitting around for up to _KEY_TTL_SECONDS."""
    await _delete(_PROGRESS_KEY.format(job_id=job_id))


async def set_export_pid(job_id: str, pid: int) -> None:
    """Written once, right after the ffmpeg subprocess is spawned (P8) - the
    cancel endpoint reads this to know what OS process group to signal,
    since Celery's own task-revocation isn't reliable for reaching a
    grandchild process under the `prefork` pool."""
    await _set(_PID_KEY.format(job_id=job_id), pid)


async def get_export_pid(job_id: str) -> int | None:
    """`None` means "nothing to kill right now" - no export running, ffmpeg
    hasn't spawned yet (job is still `queued`), or Redis is unavailable. The
    cancel endpoint treats all three the same: request the cancel flag
    regardless, only send a signal if a pid is actually available."""
    raw = await _get(_PID_KEY.format(job_id=job_id))
    return int(raw) if raw is not None else None


async def clear_export_pid(job_id: str) -> None:
    await _delete(_PID_KEY.format(job_id=job_id))


async def request_export_cancel(job_id: str) -> None:
    """Set by the cancel endpoint before it signals the process (or in place
    of signaling, if the job is still `queued` with no pid yet). `_do_export`
    checks this once before starting real work, and `_run_job`'s except
    block checks it again on any failure - either path is how a killed or
    not-yet-started export ends up `status: "cancelled"` instead of
    `"failed"` (contract §5, X7)."""
    await _set(_CANCEL_KEY.format(job_id=job_id), "1")


async def is_export_cancel_requested(job_id: str) -> bool:
    return await _get(_CANCEL_KEY.format(job_id=job_id)) is not None


async def clear_export_cancel_requested(job_id: str) -> None:
    await _delete(_CANCEL_KEY.format(job_id=job_id))
