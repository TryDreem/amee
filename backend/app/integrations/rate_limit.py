from dataclasses import dataclass

from redis import asyncio as redis

from app.integrations.redis import redis_client

# One extra second of headroom so a request landing right on the window boundary reports a
# reset_seconds that has already elapsed by the time the client retries, rather than 0.
_MIN_RESET_SECONDS = 1


@dataclass(frozen=True)
class RateLimitStatus:
    allowed: bool
    limit: int
    remaining: int
    reset_seconds: int


async def check(key: str, *, limit: int, window_seconds: int) -> RateLimitStatus:
    """Fixed-window counter: INCR the key, EXPIRE it only on the first hit in the window (NX) so
    a burst of concurrent requests can't each push the window further out. Fails open on any
    Redis error (INVARIANTS A3/A5: Redis is never a source of truth) - an outage degrades to "no
    rate limiting", never a 500 or a stuck request."""
    try:
        async with redis_client() as conn:
            count = await conn.incr(key)
            if count == 1:
                await conn.expire(key, window_seconds)
            ttl = await conn.ttl(key)
    except (KeyError, redis.RedisError):
        return RateLimitStatus(
            allowed=True, limit=limit, remaining=limit, reset_seconds=window_seconds
        )

    reset_seconds = ttl if ttl > 0 else _MIN_RESET_SECONDS
    return RateLimitStatus(
        allowed=count <= limit,
        limit=limit,
        remaining=max(0, limit - count),
        reset_seconds=reset_seconds,
    )
