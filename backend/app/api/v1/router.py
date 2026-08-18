from fastapi import APIRouter

from app.api.v1 import (
    auth,
    ecs,
    export,
    jobs,
    presets,
    projects,
    raw_transcript,
    recalculate_groups,
    reset_to_raw,
    style,
    transcribe,
)

api_router = APIRouter()

api_router.include_router(auth.router)
api_router.include_router(projects.router)
api_router.include_router(transcribe.router)
api_router.include_router(jobs.router)
api_router.include_router(raw_transcript.router)
api_router.include_router(ecs.router)
api_router.include_router(style.router)
api_router.include_router(presets.router)
api_router.include_router(recalculate_groups.router)
api_router.include_router(reset_to_raw.router)
api_router.include_router(export.router)
