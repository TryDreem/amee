import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import require_project_owner
from app.db import get_db
from app.schemas.raw_transcript import RawTranscript
from app.services import raw_transcript as raw_transcript_service

router = APIRouter(prefix="/projects", tags=["raw-transcript"])


@router.get(
    "/{project_id}/raw-transcript",
    response_model=RawTranscript,
    responses={
        404: {
            "description": "Not transcribed yet, not found, or not owned by the caller"
        }
    },
    dependencies=[Depends(require_project_owner)],
)
async def get_raw_transcript(
    project_id: uuid.UUID, session: AsyncSession = Depends(get_db)
) -> RawTranscript:
    raw_transcript = await raw_transcript_service.get_raw_transcript(
        session, project_id
    )
    if raw_transcript is None:
        raise HTTPException(status_code=404, detail="Not transcribed yet")
    return raw_transcript
