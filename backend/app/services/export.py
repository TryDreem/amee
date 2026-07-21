import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import DomainValidationError
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
from app.workers.tasks import export_task


async def start_export(
    session: AsyncSession, project_id: uuid.UUID, body: ExportRequestBody
) -> Job | None:
    """Validates `ecs`+`style` (shared with `PUT /ecs`/`PUT /style`, X5),
    persists both as a side effect (X4/X5 — the export reflects exactly
    what was submitted, not stale backend state), then enqueues
    `export_task` on the `export` queue. Returns `None` if the project
    doesn't exist."""
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
