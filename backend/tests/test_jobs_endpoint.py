import uuid

import httpx
from httpx import ASGITransport

from app.db import async_session_factory
from app.integrations import redis as redis_integration
from app.main import app
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.schemas.job import JobStatus, JobType


async def test_get_job_returns_created_job() -> None:
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="Jobs endpoint test",
            video_url="/files/projects/z/source.mp4",
        )
        job = await job_repo.create(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            job_type=JobType.transcribe,
        )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/v1/jobs/{job.id}")

        assert response.status_code == 200
        body = response.json()
        assert body["id"] == str(job.id)
        assert body["project_id"] == str(project.id)
        assert body["type"] == "transcribe"
        assert body["status"] == "queued"
        assert body["result"] is None


async def test_get_job_not_found() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/v1/jobs/{uuid.uuid4()}")

        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"


async def test_get_job_surfaces_export_progress_percent_while_processing() -> None:
    """contract §5: progress_percent is read from Redis, only for a
    processing export - not stored on the Job row itself (A5)."""
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="Progress percent test",
            video_url="/files/projects/z/source.mp4",
        )
        job = await job_repo.create(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            job_type=JobType.export,
        )
        await job_repo.update_status(
            session, job.id, status=JobStatus.processing, progress=None
        )

    await redis_integration.set_export_progress(str(job.id), 37.5)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/v1/jobs/{job.id}")

    assert response.status_code == 200
    assert response.json()["progress_percent"] == 37.5


async def test_get_job_progress_percent_is_null_for_transcribe_jobs() -> None:
    """Only export jobs ever read Redis for this field - a transcribe job
    must never surface a stray value even if one happened to exist under
    the same job id (it can't in practice, but the field is scoped by
    `type`, not just by presence in Redis)."""
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="Progress percent transcribe test",
            video_url="/files/projects/z/source.mp4",
        )
        job = await job_repo.create(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            job_type=JobType.transcribe,
        )
        await job_repo.update_status(
            session, job.id, status=JobStatus.processing, progress=None
        )

    await redis_integration.set_export_progress(str(job.id), 99.0)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/v1/jobs/{job.id}")

    assert response.status_code == 200
    assert response.json()["progress_percent"] is None


async def test_get_job_progress_percent_is_null_once_export_is_done() -> None:
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="Progress percent done test",
            video_url="/files/projects/z/source.mp4",
        )
        job = await job_repo.create(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            job_type=JobType.export,
        )
        await job_repo.update_status(
            session,
            job.id,
            status=JobStatus.done,
            progress=None,
            result={"video_url": "/files/projects/z/exports/y/video.mp4"},
        )

    await redis_integration.set_export_progress(str(job.id), 100.0)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/v1/jobs/{job.id}")

    assert response.status_code == 200
    assert response.json()["progress_percent"] is None
