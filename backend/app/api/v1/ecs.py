from fastapi import APIRouter, HTTPException

from app.schemas.ecs import ECS, ECSPutBody

router = APIRouter(prefix="/projects", tags=["ecs"])


@router.get(
    "/{project_id}/ecs",
    response_model=ECS,
    responses={404: {"description": "Not transcribed yet"}},
)
def get_ecs(project_id: str) -> ECS:
    raise HTTPException(
        status_code=501, detail="GET /projects/{id}/ecs not implemented"
    )


@router.put(
    "/{project_id}/ecs",
    response_model=ECS,
    responses={
        404: {"description": "Not transcribed yet"},
        422: {"description": "Validation failed (V1-V5)"},
    },
)
def put_ecs(project_id: str, body: ECSPutBody) -> ECS:
    raise HTTPException(
        status_code=501, detail="PUT /projects/{id}/ecs not implemented"
    )
