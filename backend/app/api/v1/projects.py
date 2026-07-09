from fastapi import APIRouter, HTTPException

from app.schemas.project import Project

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post("", response_model=Project, status_code=201)
def create_project() -> Project:
    raise HTTPException(status_code=501, detail="POST /projects not implemented")


@router.get("", response_model=list[Project])
def list_projects() -> list[Project]:
    raise HTTPException(status_code=501, detail="GET /projects not implemented")


@router.get(
    "/{project_id}",
    response_model=Project,
    responses={404: {"description": "Project not found"}},
)
def get_project(project_id: str) -> Project:
    raise HTTPException(status_code=501, detail="GET /projects/{id} not implemented")
