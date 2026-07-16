import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.style import CaptionStyleSpec, CaptionStyleSpecPutBody
from app.services import style as style_service

router = APIRouter(prefix="/projects", tags=["style"])


@router.get(
    "/{project_id}/style",
    response_model=CaptionStyleSpec,
    # overrides is sparse by design (contract §8) - only fields that differ
    # from the preset's base values should appear, not null placeholders
    # for every unset field.
    response_model_exclude_none=True,
    responses={404: {"description": "Project not found"}},
)
async def get_style(
    project_id: uuid.UUID, session: AsyncSession = Depends(get_db)
) -> CaptionStyleSpec:
    style = await style_service.get_style(session, project_id)
    if style is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return style


@router.put(
    "/{project_id}/style",
    response_model=CaptionStyleSpec,
    response_model_exclude_none=True,
    responses={
        404: {"description": "Project not found"},
        422: {"description": "Bounds validation failed against resolved preset"},
    },
)
async def put_style(
    project_id: uuid.UUID,
    body: CaptionStyleSpecPutBody,
    session: AsyncSession = Depends(get_db),
) -> CaptionStyleSpec:
    style = await style_service.put_style(session, project_id, body)
    if style is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return style
