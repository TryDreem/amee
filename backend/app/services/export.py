import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import DomainValidationError
from app.models.project import ProjectModel
from app.repositories import ecs as ecs_repo
from app.repositories import job as job_repo
from app.repositories import preset as preset_repo
from app.repositories import project as project_repo
from app.repositories import style as style_repo
from app.schemas.common import ErrorDetail
from app.schemas.export import ExportRequestBody
from app.schemas.job import Job, JobType
from app.schemas.preset import PresetBounds
from app.services import jobs as job_service
from app.services.ecs_validation import validate_segments
from app.services.style_validation import validate_overrides
from app.workers.tasks import export_srt_task, export_task


async def _resolve_and_validate(
    session: AsyncSession, project_id: uuid.UUID, body: ExportRequestBody
) -> ProjectModel | None:
    """Shared by `start_export`/`start_export_srt`: resolves the project and
    the submitted style's preset, then runs the combined validation both
    endpoints require (`ecs.segments` + `style.overrides`, X5/X6 - same
    shared path `PUT /ecs`/`PUT /style` use). Returns `None` if the project
    doesn't exist (caller turns that into a 404); raises
    `DomainValidationError` for a missing preset or any bounds/shape
    failure (caller turns that into a 422).

    A plain function, not a class: there's no state to hold between calls
    and no polymorphism to model - two call sites sharing one validation
    step is exactly what a shared function is for. This codebase has no
    classes outside dataclasses/Pydantic/ORM models anywhere (arch A1 -
    services take/return plain data, which is what keeps Celery task
    wrapping thin); introducing one here to de-duplicate 15 lines would add
    ceremony (a base class, `__init__` wiring, subclasses per job type)
    without removing anything a function doesn't already remove."""
    project = await project_repo.get(session, project_id)
    if project is None:
        return None

    preset = await preset_repo.get(session, body.style.presetId)
    if preset is None:
        raise DomainValidationError(
            [ErrorDetail(field="style.presetId", issue="preset not found")]
        )
    bounds = PresetBounds.model_validate(preset.bounds)

    details = validate_overrides(body.style.overrides, bounds)
    details += validate_segments(body.ecs.segments, bounds)
    if details:
        raise DomainValidationError(details)

    return project


async def start_export(
    session: AsyncSession, project_id: uuid.UUID, body: ExportRequestBody
) -> Job | None:
    """Validates `ecs`+`style` (shared with `PUT /ecs`/`PUT /style`, X5),
    persists both as a side effect (X5 — the export reflects exactly what
    was submitted, not stale backend state), then enqueues `export_task` on
    the `export` queue. Returns `None` if the project doesn't exist. See
    `start_export_srt` below for the endpoint that deliberately does NOT
    persist (X6)."""
    project = await _resolve_and_validate(session, project_id, body)
    if project is None:
        return None

    await ecs_repo.replace(
        session,
        project_id=project_id,
        owner_id=project.owner_id,
        segments=body.ecs.segments,
    )
    await style_repo.update(
        session,
        project_id,
        preset_id=body.style.presetId,
        per_phrase_style=body.style.perPhraseStyle,
        overrides=body.style.overrides.model_dump(exclude_none=True),
    )

    job = await job_repo.create(
        session,
        project_id=project_id,
        owner_id=project.owner_id,
        job_type=JobType.export,
    )
    export_task.delay(str(job.id))
    return await job_service.get_job(session, job.id)


async def start_export_srt(
    session: AsyncSession, project_id: uuid.UUID, body: ExportRequestBody
) -> Job | None:
    """Same request shape and same combined validation as `start_export`
    (`_resolve_and_validate` - for parity, both endpoints accept the
    identical `ExportRequestBody`), but deliberately does NOT call
    `ecs_repo.replace`/`style_repo.update`: the caller's editor screen may
    have unsaved edits (contract §12) and this endpoint must reflect
    exactly the submitted body, not write it to the DB just to produce a
    throwaway SRT (X6). Enqueues `export_srt_task` on the `export` queue
    (P5 - no new queue) with the *validated* body serialized to plain
    JSON, since there is nothing on disk/DB for the task to reload the way
    `_run_export` reloads persisted ecs/style from Postgres."""
    project = await _resolve_and_validate(session, project_id, body)
    if project is None:
        return None

    job = await job_repo.create(
        session,
        project_id=project_id,
        owner_id=project.owner_id,
        job_type=JobType.export_srt,
    )
    export_srt_task.delay(str(job.id), body.model_dump(mode="json"))
    return await job_service.get_job(session, job.id)
