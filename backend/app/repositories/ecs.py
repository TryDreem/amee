import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.integrations.whisperx import TranscribedWord
from app.models.ecs import SegmentModel, WordModel


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
