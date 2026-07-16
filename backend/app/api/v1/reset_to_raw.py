import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.recalculate import PolymorphicJobResponse
from app.schemas.reset import ResetToRawResult
from app.services import reset as reset_service

router = APIRouter(prefix="/projects", tags=["reset-to-raw"])


@router.post(
    "/{project_id}/reset-to-raw",
    responses={
        200: {"model": ResetToRawResult},
        202: {"model": PolymorphicJobResponse},
        404: {"description": "Not transcribed yet"},
    },
)
async def reset_to_raw(
    project_id: uuid.UUID, session: AsyncSession = Depends(get_db)
) -> ResetToRawResult | PolymorphicJobResponse:
    # Always 200 for MVP - only the cheap Simple Splitter exists (P5).
    # 404 only, not also 409: the Raw Transcript either exists (the
    # transcribe job wrote it once, D1) or it doesn't - there's no distinct
    # state a 409 would describe that 404 doesn't already cover, since the
    # transcript is written atomically once WhisperX finishes.
    result = await reset_service.reset_to_raw(session, project_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Not transcribed yet")
    return result
