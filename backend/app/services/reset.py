import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import raw_transcript as raw_transcript_repo
from app.schemas.ecs import Segment, Word
from app.schemas.reset import ResetToRawResult
from app.services.splitter import split_words


async def reset_to_raw(
    session: AsyncSession, project_id: uuid.UUID
) -> ResetToRawResult | None:
    """Re-runs the Initial Splitter over the project's immutable Raw
    Transcript (D1) and returns a brand-new Segment[]/Word[] — stateless,
    same non-persisting pattern as recalculate-groups (E6, contract §11).
    Raw-transcript words carry no id (D2), so every word gets a fresh one;
    unlike recalculate-groups, there's no existing id to preserve."""
    raw = await raw_transcript_repo.get_by_project(session, project_id)
    if raw is None:
        return None  # not transcribed yet - contract §11

    words = [
        Word(
            id=uuid.uuid4(),
            text=str(w["text"]),
            start=float(w["start"]),
            end=float(w["end"]),
        )
        for w in raw.words
    ]
    groups = split_words(words)
    return ResetToRawResult(
        project_id=project_id,
        owner_id=raw.owner_id,
        segments=[Segment(id=uuid.uuid4(), words=list(group)) for group in groups],
    )
