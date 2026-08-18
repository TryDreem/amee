import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_current_user_id
from app.db import get_db
from app.schemas.project import Project, ProjectPage, ProjectSort
from app.services import projects as project_service

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post(
    "",
    response_model=Project,
    status_code=201,
    responses={
        422: {"description": "Upload limits exceeded, or unsupported language code"}
    },
)
async def create_project(
    file: UploadFile = File(...),
    name: str | None = Form(None),
    language: str | None = Form(None),
    session: AsyncSession = Depends(get_db),
    owner_id: uuid.UUID = Depends(get_current_user_id),
) -> Project:
    content = await file.read()
    return await project_service.create_project(
        session,
        owner_id=owner_id,
        name=name,
        filename=file.filename or "upload.mp4",
        content=content,
        language=language,
    )


@router.get("", response_model=ProjectPage)
async def list_projects(
    limit: int = Query(
        project_service.DEFAULT_PAGE_LIMIT,
        description=(
            f"Page size. Clamped server-side to "
            f"1..{project_service.MAX_PAGE_LIMIT}, never rejected."
        ),
    ),
    offset: int = Query(0, description="Rows to skip. Negative values clamp to 0."),
    q: str | None = Query(None, description="Case-insensitive match on project name."),
    sort: ProjectSort = Query(ProjectSort.newest),
    session: AsyncSession = Depends(get_db),
) -> ProjectPage:
    # No `ge=`/`le=` on limit/offset on purpose - those would make FastAPI
    # 422 an out-of-range page size, and the contract says clamp instead.
    # The clamping itself is a business rule, so it lives in the service.
    return await project_service.list_projects(
        session, limit=limit, offset=offset, q=q, sort=sort
    )


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


@router.post(
    "/{project_id}/open",
    status_code=204,
    responses={404: {"description": "Project not found"}},
)
async def open_project(
    project_id: uuid.UUID, session: AsyncSession = Depends(get_db)
) -> None:
    found = await project_service.open_project(session, project_id)
    if not found:
        raise HTTPException(status_code=404, detail="Project not found")


@router.delete(
    "/{project_id}",
    status_code=204,
    responses={
        404: {"description": "Project not found"},
        409: {"description": "A transcribe job is still queued/processing"},
    },
)
async def delete_project(
    project_id: uuid.UUID, session: AsyncSession = Depends(get_db)
) -> None:
    try:
        found = await project_service.delete_project(session, project_id)
    except project_service.ProjectHasActiveTranscribeJob as exc:
        raise HTTPException(
            status_code=409,
            detail="A transcribe job is still queued/processing",
        ) from exc
    if not found:
        raise HTTPException(status_code=404, detail="Project not found")
