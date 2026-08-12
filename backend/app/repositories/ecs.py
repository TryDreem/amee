import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.integrations.whisperx import TranscribedWord
from app.models.ecs import SegmentModel, WordModel
from app.schemas.ecs import Segment as SegmentInput


async def create_from_split(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    owner_id: uuid.UUID,
    groups: list[list[TranscribedWord]],
) -> list[SegmentModel]:
    """Persists the Initial Splitter's output as-is — segment/word order and
    membership are an authored decision from this point on (arch §4.2), not
    something recomputed on later reads."""
    segments = [
        SegmentModel(
            project_id=project_id,
            owner_id=owner_id,
            order=segment_order,
            words=[
                WordModel(order=word_order, text=w.text, start=w.start, end=w.end)
                for word_order, w in enumerate(group)
            ],
        )
        for segment_order, group in enumerate(groups)
    ]
    session.add_all(segments)
    await session.commit()
    for segment in segments:
        await session.refresh(segment, attribute_names=["words"])
    return segments


async def replace(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    owner_id: uuid.UUID,
    segments: list[SegmentInput],
) -> list[SegmentModel]:
    """Whole-document replace (D8) — writes the client's own `Segment`/
    `Word` ids (D10) rather than minting new ones, unlike
    `create_from_split`. Deletes via Core `delete()` statements, not
    `session.delete()` + ORM cascade: cascade delete-orphan can try to
    lazy-load the `words` relationship during flush, which isn't safe under
    async SQLAlchemy without an explicit eager-load first."""
    existing_ids = (
        (
            await session.execute(
                select(SegmentModel.id).where(SegmentModel.project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    if existing_ids:
        await session.execute(
            delete(WordModel).where(WordModel.segment_id.in_(existing_ids))
        )
        await session.execute(
            delete(SegmentModel).where(SegmentModel.project_id == project_id)
        )

    new_segments = [
        SegmentModel(
            id=segment.id,
            project_id=project_id,
            owner_id=owner_id,
            order=segment_order,
            overrides=(
                segment.overrides.model_dump(exclude_none=True)
                if segment.overrides is not None
                else None
            ),
            words=[
                WordModel(
                    id=w.id, order=word_order, text=w.text, start=w.start, end=w.end
                )
                for word_order, w in enumerate(segment.words)
            ],
        )
        for segment_order, segment in enumerate(segments)
    ]
    session.add_all(new_segments)
    await session.commit()
    for segment in new_segments:
        await session.refresh(segment, attribute_names=["words"])
    return new_segments


async def delete_by_project(session: AsyncSession, project_id: uuid.UUID) -> None:
    """Same words-then-segments order as `replace` above, for the same
    reason (FK from words to segments, no ORM cascade under async
    SQLAlchemy) - used by `DELETE /projects/{id}` (contract §4), not by
    anything that also writes a replacement afterward."""
    segment_ids = (
        (
            await session.execute(
                select(SegmentModel.id).where(SegmentModel.project_id == project_id)
            )
        )
        .scalars()
        .all()
    )
    if segment_ids:
        await session.execute(
            delete(WordModel).where(WordModel.segment_id.in_(segment_ids))
        )
        await session.execute(
            delete(SegmentModel).where(SegmentModel.project_id == project_id)
        )
    await session.commit()


async def get_by_project(
    session: AsyncSession, project_id: uuid.UUID
) -> list[SegmentModel] | None:
    result = await session.execute(
        select(SegmentModel)
        .where(SegmentModel.project_id == project_id)
        .options(selectinload(SegmentModel.words))
        .order_by(SegmentModel.order)
    )
    segments = list(result.scalars().all())
    return segments or None
