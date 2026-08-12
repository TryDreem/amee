import uuid

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.raw_transcript import RawTranscriptModel

# No update, no per-row delete — intentionally. Raw Transcript is write-once
# and immutable while its project exists (INVARIANTS D1); the only way to
# violate that from this module would be to add a function that does it. The
# primary-key-on-project_id schema (app/models/raw_transcript.py) backstops
# `create` itself: a second insert for the same project raises
# IntegrityError rather than overwriting. `delete_by_project` below is the
# one deliberate exception, not a loophole: D1 is about the raw transcript
# outliving edits *within* a project's lifetime (it's what Reset to Raw
# depends on), not about surviving the project's own deletion — nothing
# should reference a raw transcript whose project no longer exists.


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


async def delete_by_project(session: AsyncSession, project_id: uuid.UUID) -> None:
    await session.execute(
        delete(RawTranscriptModel).where(RawTranscriptModel.project_id == project_id)
    )
    await session.commit()
