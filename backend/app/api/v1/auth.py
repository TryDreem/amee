import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import SESSION_COOKIE_NAME, get_current_user_id
from app.db import get_db
from app.schemas.user import User
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


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


@router.post("/logout", status_code=204)
async def logout(response: Response) -> None:
    # Deliberately does NOT take Depends(get_current_user_id) - that would mint a fresh guest
    # just to immediately clear its own cookie. Logging out just means "forget whatever session
    # this browser has, if any" - clearing the cookie is correct whether or not one was ever set.
    # Does not delete the underlying User row (guest or real): the next request from this
    # browser gets a new guest, but nothing about "logout" should destroy existing projects.
    response.delete_cookie(SESSION_COOKIE_NAME)
