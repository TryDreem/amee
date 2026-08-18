import uuid

from fastapi import Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.exceptions import RateLimitedError
from app.integrations import rate_limit
from app.integrations.session_cookie import sign_user_id, verify_cookie
from app.repositories import user as user_repo

SESSION_COOKIE_NAME = "amee_session"


async def get_current_user_id(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_db),
) -> uuid.UUID:
    """The one place "who is making this request" is decided. Every route that used to import
    `PLACEHOLDER_OWNER_ID` (app/constants.py) takes `Depends(get_current_user_id)` instead.

    No valid cookie, or a cookie pointing at a since-deleted user, silently mints a fresh guest
    and sets a new cookie on the response — guest identity is automatic, never an explicit user
    action (docs/api-contract.md §15, proposed). This never 401s: a session, guest or real,
    always exists once this dependency has run once for a given browser."""
    cookie = request.cookies.get(SESSION_COOKIE_NAME)
    candidate_id = verify_cookie(cookie) if cookie else None
    if candidate_id is not None:
        user = await user_repo.get(session, candidate_id)
        if user is not None:
            return user.id

    user = await user_repo.create_guest(session)
    response.set_cookie(
        SESSION_COOKIE_NAME,
        sign_user_id(user.id),
        httponly=True,
        samesite="lax",
    )
    return user.id


# --- Rate limiting (Part B §7) ---
#
# Three separate limiters, not one generic knob:
#   - blanket per-IP: applied to every /api/v1 route EXCEPT GET /jobs/{id} (see router.py) -
#     that route is polled roughly every 2s while a job is processing (arch §2.8's own stated
#     interval), which alone is 30 requests/min - the same as this whole budget, leaving zero
#     room for anything else during exactly the window a user is most likely to also be doing
#     other things. Confirmed with the human rather than silently picking a workaround.
#   - per-IP upload: POST /projects specifically, its own tighter hourly budget.
#   - per-user action: transcribe/export/export-srt specifically, keyed by owner_id - the
#     already-fixed contract §1 shape. The human confirmed the per-IP numbers below directly;
#     no separate per-user number was given, so this defaults to the same figure as the per-IP
#     upload limit and the 5-project quota rather than inventing an unrelated one. One constant,
#     easy to retune later.
_IP_REQUEST_LIMIT = 30
_IP_REQUEST_WINDOW_SECONDS = 60

_IP_UPLOAD_LIMIT = 5
_IP_UPLOAD_WINDOW_SECONDS = 60 * 60

_USER_ACTION_LIMIT = 5
_USER_ACTION_WINDOW_SECONDS = 60 * 60


def _client_ip(request: Request) -> str:
    """request.client.host only - no X-Forwarded-For parsing. Correct for this app's actual
    single-VPS deployment target; behind a reverse proxy/load balancer without that header
    handled, every request would look like it came from the proxy's own address. A known
    simplification, not an oversight."""
    return request.client.host if request.client else "unknown"


def _apply_rate_limit_headers(
    response: Response, status: rate_limit.RateLimitStatus
) -> None:
    response.headers["X-RateLimit-Limit"] = str(status.limit)
    response.headers["X-RateLimit-Remaining"] = str(status.remaining)
    response.headers["X-RateLimit-Reset"] = str(status.reset_seconds)


async def enforce_blanket_ip_limit(request: Request, response: Response) -> None:
    status = await rate_limit.check(
        f"ratelimit:ip:{_client_ip(request)}",
        limit=_IP_REQUEST_LIMIT,
        window_seconds=_IP_REQUEST_WINDOW_SECONDS,
    )
    _apply_rate_limit_headers(response, status)
    if not status.allowed:
        raise RateLimitedError(
            field="ip",
            limit=status.limit,
            remaining=status.remaining,
            reset_seconds=status.reset_seconds,
        )


async def enforce_upload_ip_limit(request: Request, response: Response) -> None:
    status = await rate_limit.check(
        f"ratelimit:upload_ip:{_client_ip(request)}",
        limit=_IP_UPLOAD_LIMIT,
        window_seconds=_IP_UPLOAD_WINDOW_SECONDS,
    )
    _apply_rate_limit_headers(response, status)
    if not status.allowed:
        raise RateLimitedError(
            field="ip",
            limit=status.limit,
            remaining=status.remaining,
            reset_seconds=status.reset_seconds,
        )


async def enforce_user_action_limit(
    response: Response, owner_id: uuid.UUID = Depends(get_current_user_id)
) -> None:
    status = await rate_limit.check(
        f"ratelimit:user_action:{owner_id}",
        limit=_USER_ACTION_LIMIT,
        window_seconds=_USER_ACTION_WINDOW_SECONDS,
    )
    _apply_rate_limit_headers(response, status)
    if not status.allowed:
        raise RateLimitedError(
            field="owner_id",
            limit=status.limit,
            remaining=status.remaining,
            reset_seconds=status.reset_seconds,
        )
