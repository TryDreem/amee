from fastapi import APIRouter, HTTPException

from app.schemas.job import Job

router = APIRouter(prefix="/projects", tags=["transcription"])


@router.post(
    "/{project_id}/transcribe",
    response_model=Job,
    status_code=202,
    responses={
        409: {"description": "A transcribe job is already queued/processing/done"}
    },
)
def transcribe_project(project_id: str) -> Job:
    raise HTTPException(
        status_code=501, detail="POST /projects/{id}/transcribe not implemented"
    )
