import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import DomainValidationError
from app.integrations.whisperx import TranscribedWord
from app.models.ecs import SegmentModel
from app.repositories import ecs as ecs_repo
from app.repositories import preset as preset_repo
from app.repositories import style as style_repo
from app.schemas.ecs import ECS, ECSPutBody, Segment, Word
from app.schemas.preset import PresetBounds
from app.schemas.style import StyleOverrides
from app.services.ecs_validation import validate_segments
from app.services.splitter import split_words


def _to_schema(
    project_id: uuid.UUID, owner_id: uuid.UUID, segments: list[SegmentModel]
) -> ECS:
    return ECS(
        project_id=project_id,
        owner_id=owner_id,
        segments=[
            Segment(
                id=segment.id,
                words=[
                    Word(id=word.id, text=word.text, start=word.start, end=word.end)
                    for word in segment.words
                ],
                overrides=(
                    StyleOverrides.model_validate(segment.overrides)
                    if segment.overrides is not None
                    else None
                ),
            )
            for segment in segments
        ],
    )


async def create_initial_ecs(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    owner_id: uuid.UUID,
    words: list[TranscribedWord],
) -> ECS:
    """Runs the Initial Splitter and persists its output (arch §5.1) — called
    exactly once per project, from the transcribe job right after the Raw
    Transcript is written, never from a route directly."""
    groups = split_words(words)
    segments = await ecs_repo.create_from_split(
        session, project_id=project_id, owner_id=owner_id, groups=groups
    )
    return _to_schema(project_id, owner_id, segments)


async def get_ecs(session: AsyncSession, project_id: uuid.UUID) -> ECS | None:
    segments = await ecs_repo.get_by_project(session, project_id)
    if segments is None:
        return None
    return _to_schema(project_id, segments[0].owner_id, segments)


async def put_ecs(
    session: AsyncSession, project_id: uuid.UUID, body: ECSPutBody
) -> ECS | None:
    existing = await ecs_repo.get_by_project(session, project_id)
    if existing is None:
        return None  # not transcribed yet - same 404 condition as GET (contract §7)

    style = await style_repo.get(session, project_id)
    if style is None:
        raise ValueError(f"style for project {project_id} not found")
    preset = await preset_repo.get(session, style.preset_id)
    if preset is None:
        raise ValueError(f"preset {style.preset_id} not found")
    bounds = PresetBounds.model_validate(preset.bounds)

    details = validate_segments(body.segments, bounds)
    if details:
        raise DomainValidationError(details)

    owner_id = existing[0].owner_id
    updated = await ecs_repo.replace(
        session, project_id=project_id, owner_id=owner_id, segments=body.segments
    )
    return _to_schema(project_id, owner_id, updated)
