import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.db import async_session_factory
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.schemas.job import JobStatus, JobType


async def _make_project(session: AsyncSession) -> uuid.UUID:
    project = await project_repo.create(
        session,
        owner_id=uuid.uuid4(),
        name="Job repo test project",
        video_url="/files/projects/z/source.mp4",
    )
    return project.id


async def test_create_and_get_roundtrip() -> None:
    async with async_session_factory() as session:
        project_id = await _make_project(session)
        created = await job_repo.create(
            session,
            project_id=project_id,
            owner_id=uuid.uuid4(),
            job_type=JobType.transcribe,
        )

        fetched = await job_repo.get(session, created.id)

        assert fetched is not None
        assert fetched.project_id == project_id
        assert fetched.type == JobType.transcribe
        assert fetched.status == JobStatus.queued
        assert fetched.error is None
        assert fetched.result is None


async def test_update_status_transitions() -> None:
    async with async_session_factory() as session:
        project_id = await _make_project(session)
        job = await job_repo.create(
            session,
            project_id=project_id,
            owner_id=uuid.uuid4(),
            job_type=JobType.transcribe,
        )

        await job_repo.update_status(session, job.id, status=JobStatus.processing)
        mid = await job_repo.get(session, job.id)
        assert mid is not None
        assert mid.status == JobStatus.processing

        await job_repo.update_status(session, job.id, status=JobStatus.done)
        done = await job_repo.get(session, job.id)
        assert done is not None
        assert done.status == JobStatus.done


async def test_update_status_records_error() -> None:
    async with async_session_factory() as session:
        project_id = await _make_project(session)
        job = await job_repo.create(
            session,
            project_id=project_id,
            owner_id=uuid.uuid4(),
            job_type=JobType.transcribe,
        )

        await job_repo.update_status(
            session, job.id, status=JobStatus.failed, error="whisperx blew up"
        )

        failed = await job_repo.get(session, job.id)
        assert failed is not None
        assert failed.status == JobStatus.failed
        assert failed.error == "whisperx blew up"
