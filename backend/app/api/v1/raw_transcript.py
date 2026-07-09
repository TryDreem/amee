from fastapi import APIRouter, HTTPException

from app.schemas.raw_transcript import RawTranscript

router = APIRouter(prefix="/projects", tags=["raw-transcript"])


@router.get(
    "/{project_id}/raw-transcript",
    response_model=RawTranscript,
    responses={404: {"description": "Not transcribed yet"}},
)
def get_raw_transcript(project_id: str) -> RawTranscript:
    raise HTTPException(
        status_code=501, detail="GET /projects/{id}/raw-transcript not implemented"
    )
