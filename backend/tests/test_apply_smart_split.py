import asyncio
import uuid
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.db import async_session_factory
from app.integrations import storage
from app.integrations.llm_split import LlmSplitError
from app.integrations.whisperx import TranscribedWord, Transcription
from app.models.job import JobModel
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.schemas.job import JobStatus, JobType
from app.services import ecs as ecs_service
from app.services import style as style_service
from app.workers.celery_app import celery_app
from app.workers.tasks import _apply_smart_split, transcribe_task

_FAKE_WORDS = [
    TranscribedWord(text=f"w{i}", start=i * 0.3, end=i * 0.3 + 0.2) for i in range(10)
]
# The smart-split gate reads the language WhisperX actually detected
# (raw.language), not the upload-time Project.language choice - so these
# mocked transcriptions carry the language each end-to-end test needs.
_FAKE_TRANSCRIPTION_EN = Transcription(words=_FAKE_WORDS, language="en")
_FAKE_TRANSCRIPTION_JA = Transcription(words=_FAKE_WORDS, language="ja")


@pytest.fixture
def eager_celery() -> Iterator[None]:
    original_eager = celery_app.conf.task_always_eager
    original_propagates = celery_app.conf.task_eager_propagates
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True
    try:
        yield
    finally:
        celery_app.conf.task_always_eager = original_eager
        celery_app.conf.task_eager_propagates = original_propagates


async def _create_project_with_ecs(
    video_path: Path, *, language: str | None
) -> uuid.UUID:
    async with async_session_factory() as session:
        project_id = uuid.uuid4()
        _, video_url = storage.save_video(
            project_id, "sample.mp4", video_path.read_bytes()
        )
        project = await project_repo.create(
            session,
            project_id=project_id,
            owner_id=uuid.uuid4(),
            name="Smart split test",
            video_url=video_url,
            language=language,
        )
        await style_service.create_default_style(
            session, project_id=project.id, owner_id=project.owner_id
        )
        await ecs_service.create_initial_ecs(
            session, project_id=project.id, owner_id=project.owner_id, words=_FAKE_WORDS
        )
        return project.id


async def _get_ecs_word_texts(project_id: uuid.UUID) -> list[str]:
    async with async_session_factory() as session:
        ecs = await ecs_service.get_ecs(session, project_id)
    assert ecs is not None
    return [w.text for seg in ecs.segments for w in seg.words]


async def _get_segment_word_counts(project_id: uuid.UUID) -> list[int]:
    async with async_session_factory() as session:
        ecs = await ecs_service.get_ecs(session, project_id)
    assert ecs is not None
    return [len(seg.words) for seg in ecs.segments]


# --- _apply_smart_split directly (no Celery, no DB job row involved) ---


async def test_apply_smart_split_replaces_ecs_with_llm_groups(
    sample_video: Path,
) -> None:
    project_id = await _create_project_with_ecs(sample_video, language="en")
    async with async_session_factory() as session:
        project = await project_repo.get(session, project_id)
    assert project is not None

    with patch(
        "app.services.smart_splitter.llm_split.request_breaks", new_callable=AsyncMock
    ) as mock_request:
        mock_request.return_value = [4]  # two groups of 5
        await _apply_smart_split(project_id, owner_id=project.owner_id, language="en")

    assert await _get_segment_word_counts(project_id) == [5, 5]
    # Original word id/text/start/end are byte-for-byte unchanged - only
    # which segment each belongs to changed.
    assert await _get_ecs_word_texts(project_id) == [w.text for w in _FAKE_WORDS]


async def test_apply_smart_split_does_not_bump_project_updated_at(
    sample_video: Path,
) -> None:
    """D12: updated_at tracks user edits (PUT /ecs, PUT /style) only. The
    smart-split rewrite is an automatic post-transcribe refinement, not a
    user action - it calls ecs_repo.replace() directly, bypassing
    ecs_service.put_ecs() (the only place that bumps updated_at), precisely
    so this stays true."""
    project_id = await _create_project_with_ecs(sample_video, language="en")
    async with async_session_factory() as session:
        project = await project_repo.get(session, project_id)
    assert project is not None
    before = project.updated_at

    with patch(
        "app.services.smart_splitter.llm_split.request_breaks", new_callable=AsyncMock
    ) as mock_request:
        mock_request.return_value = [4]
        await _apply_smart_split(project_id, owner_id=project.owner_id, language="en")

    async with async_session_factory() as session:
        after = await project_repo.get(session, project_id)
    assert after is not None
    assert after.updated_at == before


async def test_apply_smart_split_keeps_dumb_split_when_llm_exhausts_attempts(
    sample_video: Path,
) -> None:
    project_id = await _create_project_with_ecs(sample_video, language="en")
    async with async_session_factory() as session:
        project = await project_repo.get(session, project_id)
    assert project is not None
    original_texts = await _get_ecs_word_texts(project_id)

    with patch(
        "app.services.smart_splitter.llm_split.request_breaks", new_callable=AsyncMock
    ) as mock_request:
        mock_request.side_effect = LlmSplitError("provider unreachable")
        await _apply_smart_split(project_id, owner_id=project.owner_id, language="en")

    assert await _get_ecs_word_texts(project_id) == original_texts


# --- End-to-end via transcribe_task/_run_transcribe --------------------


async def _create_queued_transcribe_job(
    video_path: Path, *, language: str | None
) -> uuid.UUID:
    async with async_session_factory() as session:
        project_id = uuid.uuid4()
        _, video_url = storage.save_video(
            project_id, "sample.mp4", video_path.read_bytes()
        )
        project = await project_repo.create(
            session,
            project_id=project_id,
            owner_id=uuid.uuid4(),
            name="Transcribe+smart-split test",
            video_url=video_url,
            language=language,
        )
        job = await job_repo.create(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            job_type=JobType.transcribe,
        )
        return job.id


async def _get_job(job_id: uuid.UUID) -> JobModel:
    async with async_session_factory() as session:
        job = await job_repo.get(session, job_id)
        assert job is not None
        return job


def test_transcribe_task_still_reaches_done_when_smart_split_exhausts_attempts(
    eager_celery: None, sample_video: Path
) -> None:
    """The single most important test in this step: proves P7 end-to-end -
    a smart-split that never produces a valid result must not fail the
    overall transcribe Job."""
    job_id = asyncio.run(_create_queued_transcribe_job(sample_video, language="en"))

    with (
        patch(
            "app.services.raw_transcript.transcribe_video",
            return_value=_FAKE_TRANSCRIPTION_EN,
        ),
        patch(
            "app.services.smart_splitter.llm_split.request_breaks",
            new_callable=AsyncMock,
        ) as mock_request,
    ):
        mock_request.side_effect = LlmSplitError("provider unreachable")
        transcribe_task.delay(str(job_id))

    finished = asyncio.run(_get_job(job_id))
    assert finished.status == JobStatus.done
    assert finished.error is None


def test_transcribe_task_still_reaches_done_when_smart_split_raises_unexpectedly(
    eager_celery: None, sample_video: Path
) -> None:
    """A genuinely unexpected failure inside smart-split (not just an LLM
    declining) - e.g. a DB hiccup while replacing the ECS - must also not
    fail the overall transcribe Job (P7). This is what the try/except
    around `_apply_smart_split` in `transcribe_split_and_persist_ecs`
    guards against, now that there's no separate Job-row/`_run_job`
    boundary providing that isolation for free."""
    job_id = asyncio.run(_create_queued_transcribe_job(sample_video, language="en"))

    with (
        patch(
            "app.services.raw_transcript.transcribe_video",
            return_value=_FAKE_TRANSCRIPTION_EN,
        ),
        patch(
            "app.workers.tasks.smart_splitter.try_smart_split",
            side_effect=RuntimeError("db exploded"),
        ),
    ):
        transcribe_task.delay(str(job_id))

    finished = asyncio.run(_get_job(job_id))
    assert finished.status == JobStatus.done
    assert finished.error is None


def test_transcribe_task_waits_for_smart_split_to_replace_ecs(
    eager_celery: None, sample_video: Path
) -> None:
    job_id = asyncio.run(_create_queued_transcribe_job(sample_video, language="en"))
    job = asyncio.run(_get_job(job_id))

    with (
        patch(
            "app.services.raw_transcript.transcribe_video",
            return_value=_FAKE_TRANSCRIPTION_EN,
        ),
        patch(
            "app.services.smart_splitter.llm_split.request_breaks",
            new_callable=AsyncMock,
        ) as mock_request,
    ):
        mock_request.return_value = [4]
        transcribe_task.delay(str(job_id))

    finished = asyncio.run(_get_job(job_id))
    assert finished.status == JobStatus.done
    assert asyncio.run(_get_segment_word_counts(job.project_id)) == [5, 5]


def test_transcribe_task_skips_smart_split_for_unsupported_language(
    eager_celery: None, sample_video: Path
) -> None:
    job_id = asyncio.run(_create_queued_transcribe_job(sample_video, language="ja"))
    job = asyncio.run(_get_job(job_id))

    with (
        patch(
            "app.services.raw_transcript.transcribe_video",
            return_value=_FAKE_TRANSCRIPTION_JA,
        ),
        patch(
            "app.services.smart_splitter.llm_split.request_breaks",
            new_callable=AsyncMock,
        ) as mock_request,
    ):
        transcribe_task.delay(str(job_id))

    finished = asyncio.run(_get_job(job_id))
    assert finished.status == JobStatus.done
    mock_request.assert_not_called()
    assert asyncio.run(_get_ecs_word_texts(job.project_id)) == [
        w.text for w in _FAKE_WORDS
    ]
