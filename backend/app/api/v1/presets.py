from fastapi import APIRouter, HTTPException

from app.schemas.preset import Preset

router = APIRouter(prefix="/presets", tags=["presets"])


@router.get("", response_model=list[Preset])
def list_presets() -> list[Preset]:
    raise HTTPException(status_code=501, detail="GET /presets not implemented")
