import os
import secrets
import uuid

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import SESSION_COOKIE_NAME, get_current_user_id
from app.db import get_db
from app.integrations import google_oauth
from app.integrations.google_oauth import GoogleOAuthError
from app.integrations.session_cookie import sign_user_id
from app.schemas.user import User
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])

# Short-lived, single-purpose: set on /google/start, read and cleared on /google/callback. Its
# only job is proving the callback belongs to a flow this browser actually began, so an attacker
# cannot feed a victim a crafted callback URL and silently sign them into the attacker's account.
_OAUTH_STATE_COOKIE_NAME = "amee_oauth_state"
_OAUTH_STATE_MAX_AGE_SECONDS = 600


def _frontend_origin() -> str:
    """Where the callback sends the browser once the session cookie is set. Env-driven rather
    than hardcoded: the dev frontend is on a per-worktree port (.env.local) and production is a
    different origin entirely."""
    return os.environ.get("AMEE_FRONTEND_ORIGIN", "http://localhost:8001")


def _callback_url(request: Request) -> str:
    """Must be byte-identical between /start and /callback — Google compares it against the
    exchange request and rejects a mismatch, so deriving it once here rather than writing the
    string twice removes the most common way this flow breaks. It also has to be registered
    verbatim in the Google Cloud Console's own redirect-URI list."""
    return str(request.url_for("google_callback"))


@router.get(
    "/me",
    response_model=User,
    responses={
        404: {"description": "Resolved session pointed at a since-deleted user"}
    },
)
async def get_me(
    session: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> User:
    # get_current_user_id already minted-or-verified a real row for this request, so this only
    # 404s in the rare window where it was deleted between that check and this one.
    user = await auth_service.get_current_user(session, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post(
    "/me/avatar",
    response_model=User,
    responses={
        404: {"description": "Resolved session pointed at a since-deleted user"},
        422: {"description": "Unsupported image format or file too large"},
    },
)
async def update_avatar(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
) -> User:
    content = await file.read()
    user = await auth_service.update_avatar(
        session, user_id, filename=file.filename or "avatar.jpg", content=content
    )
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/logout", status_code=204)
async def logout(response: Response) -> None:
    # Deliberately does NOT take Depends(get_current_user_id) - that would mint a fresh guest
    # just to immediately clear its own cookie. Logging out just means "forget whatever session
    # this browser has, if any" - clearing the cookie is correct whether or not one was ever set.
    # Does not delete the underlying User row (guest or real): the next request from this
    # browser gets a new guest, but nothing about "logout" should destroy existing projects.
    response.delete_cookie(SESSION_COOKIE_NAME)


@router.get("/google/start")
async def google_start(request: Request) -> RedirectResponse:
    """302s to Google's consent screen. Not a JSON endpoint — the browser navigates here."""
    state = secrets.token_urlsafe(32)
    try:
        url = google_oauth.authorize_url(
            redirect_uri=_callback_url(request), state=state
        )
    except GoogleOAuthError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    response = RedirectResponse(url, status_code=307)
    response.set_cookie(
        _OAUTH_STATE_COOKIE_NAME,
        state,
        httponly=True,
        # Not "strict": the callback arrives as a top-level navigation from accounts.google.com,
        # and a strict cookie is withheld on exactly that kind of cross-site entry — the state
        # check would then fail every single time.
        samesite="lax",
        max_age=_OAUTH_STATE_MAX_AGE_SECONDS,
    )
    return response


@router.get("/google/callback", name="google_callback")
async def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    session: AsyncSession = Depends(get_db),
    current_user_id: uuid.UUID = Depends(get_current_user_id),
) -> RedirectResponse:
    """Where Google sends the browser back. Every failure path lands the user back on the
    frontend with a query flag rather than showing them a raw API error page — they arrived here
    by clicking a button in the app, so the app is where they should end up either way."""
    expected_state = request.cookies.get(_OAUTH_STATE_COOKIE_NAME)

    def _fail(reason: str) -> RedirectResponse:
        failed = RedirectResponse(
            f"{_frontend_origin()}/?auth_error={reason}", status_code=307
        )
        failed.delete_cookie(_OAUTH_STATE_COOKIE_NAME)
        return failed

    # The user pressed "cancel" on Google's own consent screen. Not an error to report loudly.
    if error is not None:
        return _fail("cancelled")
    if not code or not state or not expected_state:
        return _fail("invalid_request")
    if not secrets.compare_digest(state, expected_state):
        return _fail("state_mismatch")

    try:
        profile = await google_oauth.exchange_code(
            code=code, redirect_uri=_callback_url(request)
        )
    except GoogleOAuthError:
        return _fail("exchange_failed")

    user_id = await auth_service.sign_in_with_google(
        session, current_user_id=current_user_id, profile=profile
    )

    response = RedirectResponse(_frontend_origin(), status_code=307)
    response.delete_cookie(_OAUTH_STATE_COOKIE_NAME)
    # Overwrites whatever session cookie the request arrived with (a guest's, normally) — this
    # is the moment the browser stops being that guest and becomes the signed-in account.
    response.set_cookie(
        SESSION_COOKIE_NAME, sign_user_id(user_id), httponly=True, samesite="lax"
    )
    return response
