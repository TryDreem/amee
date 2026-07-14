import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.whisperx import TranscribedWord
from app.models.ecs import SegmentModel
from app.repositories import ecs as ecs_repo
from app.schemas.ecs import ECS, Segment, Word
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
