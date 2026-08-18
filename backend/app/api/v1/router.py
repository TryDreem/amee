from fastapi import APIRouter, Depends

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
from app.api.v1.deps import enforce_blanket_ip_limit

api_router = APIRouter()

# The blanket per-IP limit (deps.py) applies to every router below except jobs.router - GET
# /jobs/{id} is polled roughly every 2s while a job is processing (arch §2.8), which alone would
# consume this whole per-minute budget. Added per-router via include_router's own `dependencies=`
# rather than on api_router itself, specifically so jobs.router can opt out.
_rate_limited = [Depends(enforce_blanket_ip_limit)]

api_router.include_router(auth.router, dependencies=_rate_limited)
api_router.include_router(projects.router, dependencies=_rate_limited)
api_router.include_router(transcribe.router, dependencies=_rate_limited)
api_router.include_router(jobs.router)
api_router.include_router(raw_transcript.router, dependencies=_rate_limited)
api_router.include_router(ecs.router, dependencies=_rate_limited)
api_router.include_router(style.router, dependencies=_rate_limited)
api_router.include_router(presets.router, dependencies=_rate_limited)
api_router.include_router(recalculate_groups.router, dependencies=_rate_limited)
api_router.include_router(reset_to_raw.router, dependencies=_rate_limited)
api_router.include_router(export.router, dependencies=_rate_limited)
