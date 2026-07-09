from fastapi import APIRouter, HTTPException

from app.schemas.export import ExportRequestBody
from app.schemas.job import Job

router = APIRouter(prefix="/projects", tags=["export"])


@router.post(
    "/{project_id}/export",
    response_model=Job,
    status_code=202,
    responses={
        422: {"description": "Validation failed (shared with PUT /ecs, PUT /style)"}
    },
)
def export_project(project_id: str, body: ExportRequestBody) -> Job:
    raise HTTPException(
        status_code=501, detail="POST /projects/{id}/export not implemented"
    )
