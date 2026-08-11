import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from redis import asyncio as redis

# job_id-scoped key, not a hash - this is the only field this module manages
# so far (progress). Written on every ffmpeg -progress tick, read on every
# GET /jobs/{id} poll (contract §5).
_PROGRESS_KEY = "job:{job_id}:progress_percent"

# Bounds the blast radius of a leaked key if a task ever crashes between
# writing this and clearing it on completion/failure - matches INVARIANTS
# A3/A5: Redis is never a source of truth, so a value quietly expiring just
# means "no progress shown", never a stuck or wrong Job row. Comfortably
# above any export this app expects to run (contract has no fixed duration
# cap, but an hour-long render is already an extreme outlier for burned-in
# captions).
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


async def set_export_progress(job_id: str, percent: float) -> None:
    """Best-effort by design (A3/A5): callers must not let a Redis failure
    here fail the export itself - the burn-in continues either way, just
    without a live progress readout."""
    try:
        async with _client() as client:
            await client.set(
                _PROGRESS_KEY.format(job_id=job_id), percent, ex=_KEY_TTL_SECONDS
            )
    except (KeyError, redis.RedisError):
        pass


async def get_export_progress(job_id: str) -> float | None:
    """`None` covers four indistinguishable-by-design cases: no export is
    running for this job, it hasn't written its first tick yet, Redis is
    unavailable, or it was never configured. `GET /jobs/{id}` (contract §5)
    surfaces all four the same way - `progress_percent: null` - since A3
    means a client can never treat "no value" as meaningfully different
    from "Redis is down"."""
    try:
        async with _client() as client:
            raw = await client.get(_PROGRESS_KEY.format(job_id=job_id))
    except (KeyError, redis.RedisError):
        return None
    return float(raw) if raw is not None else None


async def clear_export_progress(job_id: str) -> None:
    """Called once the export task reaches a terminal state - the TTL would
    clean this up eventually regardless, but an explicit clear means a
    fast-finishing export doesn't leave a stale 100%-minus-epsilon value
    sitting around for up to _KEY_TTL_SECONDS."""
    try:
        async with _client() as client:
            await client.delete(_PROGRESS_KEY.format(job_id=job_id))
    except (KeyError, redis.RedisError):
        pass
