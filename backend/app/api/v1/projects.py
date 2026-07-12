import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.project import Project
from app.services import projects as project_service

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post("", response_model=Project, status_code=201)
async def create_project(
    file: UploadFile = File(...),
    name: str | None = Form(None),
    session: AsyncSession = Depends(get_db),
) -> Project:
    content = await file.read()
    return await project_service.create_project(
        session, name=name, filename=file.filename or "upload.mp4", content=content
    )


@router.get("", response_model=list[Project])
async def list_projects(session: AsyncSession = Depends(get_db)) -> list[Project]:
    return await project_service.list_projects(session)


@router.get(
    "/{project_id}",
    response_model=Project,
    responses={404: {"description": "Project not found"}},
)
async def get_project(
    project_id: uuid.UUID, session: AsyncSession = Depends(get_db)
) -> Project:
    project = await project_service.get_project(session, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
