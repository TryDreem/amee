import uuid

from fastapi import Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.integrations.session_cookie import sign_user_id, verify_cookie
from app.repositories import user as user_repo

_SESSION_COOKIE_NAME = "amee_session"


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
    cookie = request.cookies.get(_SESSION_COOKIE_NAME)
    candidate_id = verify_cookie(cookie) if cookie else None
    if candidate_id is not None:
        user = await user_repo.get(session, candidate_id)
        if user is not None:
            return user.id

    user = await user_repo.create_guest(session)
    response.set_cookie(
        _SESSION_COOKIE_NAME,
        sign_user_id(user.id),
        httponly=True,
        samesite="lax",
    )
    return user.id
