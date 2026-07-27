import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.raw_transcript import RawTranscriptModel

# No update, no delete — intentionally. Raw Transcript is write-once and
# immutable (INVARIANTS D1); the only way to violate that from this module
# would be to add a function that does it. The primary-key-on-project_id
# schema (app/models/raw_transcript.py) backstops `create` itself: a second
# insert for the same project raises IntegrityError rather than overwriting.


async def create(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    owner_id: uuid.UUID,
    words: list[dict[str, str | float]],
    language: str | None = None,
) -> RawTranscriptModel:
    raw_transcript = RawTranscriptModel(
        project_id=project_id, owner_id=owner_id, words=words, language=language
    )
    session.add(raw_transcript)
    await session.commit()
    await session.refresh(raw_transcript)
    return raw_transcript


async def get_by_project(
    session: AsyncSession, project_id: uuid.UUID
) -> RawTranscriptModel | None:
    return await session.get(RawTranscriptModel, project_id)
