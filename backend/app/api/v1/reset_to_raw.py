from fastapi import APIRouter, HTTPException

from app.schemas.recalculate import PolymorphicJobResponse
from app.schemas.reset import ResetToRawResult

router = APIRouter(prefix="/projects", tags=["reset-to-raw"])


@router.post(
    "/{project_id}/reset-to-raw",
    responses={
        200: {"model": ResetToRawResult},
        202: {"model": PolymorphicJobResponse},
        404: {"description": "Not transcribed yet"},
        409: {"description": "Not transcribed yet"},
    },
)
def reset_to_raw(project_id: str) -> ResetToRawResult | PolymorphicJobResponse:
    raise HTTPException(
        status_code=501, detail="POST /projects/{id}/reset-to-raw not implemented"
    )
