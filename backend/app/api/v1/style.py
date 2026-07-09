from fastapi import APIRouter, HTTPException

from app.schemas.style import CaptionStyleSpec, CaptionStyleSpecPutBody

router = APIRouter(prefix="/projects", tags=["style"])


@router.get("/{project_id}/style", response_model=CaptionStyleSpec)
def get_style(project_id: str) -> CaptionStyleSpec:
    raise HTTPException(
        status_code=501, detail="GET /projects/{id}/style not implemented"
    )


@router.put(
    "/{project_id}/style",
    response_model=CaptionStyleSpec,
    responses={
        422: {"description": "Bounds validation failed against resolved preset"}
    },
)
def put_style(project_id: str, body: CaptionStyleSpecPutBody) -> CaptionStyleSpec:
    raise HTTPException(
        status_code=501, detail="PUT /projects/{id}/style not implemented"
    )
