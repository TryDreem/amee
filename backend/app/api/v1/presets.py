from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.preset import Preset
from app.services import presets as preset_service

router = APIRouter(prefix="/presets", tags=["presets"])


@router.get("", response_model=list[Preset])
async def list_presets(session: AsyncSession = Depends(get_db)) -> list[Preset]:
    return await preset_service.list_presets(session)
