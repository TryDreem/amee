import os

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

_client: redis.Redis | None = None


def _get_client() -> redis.Redis:
    """Lazy singleton, not a module-level connection at import time: tests
    and any process that imports this module but never touches Redis (most
    of the API layer) shouldn't pay for a connection pool they don't use.
    Unlike `app/db.py`'s `AMEE_DB_URL` (which fails loud on a missing env
    var, because Postgres is the source of truth), a missing
    `AMEE_REDIS_URL` is treated as just another way Redis can be
    unavailable (A3) - every caller below already catches this alongside
    `RedisError`, so "never configured" degrades the same as "configured
    but down", never a crash."""
    global _client
    if _client is None:
        _client = redis.from_url(os.environ["AMEE_REDIS_URL"], decode_responses=True)
    return _client


async def set_export_progress(job_id: str, percent: float) -> None:
    """Best-effort by design (A3/A5): callers must not let a Redis failure
    here fail the export itself - the burn-in continues either way, just
    without a live progress readout."""
    try:
        await _get_client().set(
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
        raw = await _get_client().get(_PROGRESS_KEY.format(job_id=job_id))
    except (KeyError, redis.RedisError):
        return None
    return float(raw) if raw is not None else None


async def clear_export_progress(job_id: str) -> None:
    """Called once the export task reaches a terminal state - the TTL would
    clean this up eventually regardless, but an explicit clear means a
    fast-finishing export doesn't leave a stale 100%-minus-epsilon value
    sitting around for up to _KEY_TTL_SECONDS."""
    try:
        await _get_client().delete(_PROGRESS_KEY.format(job_id=job_id))
    except (KeyError, redis.RedisError):
        pass
