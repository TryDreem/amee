import uuid

import httpx
from httpx import ASGITransport

from app.db import async_session_factory
from app.integrations import redis as redis_integration
from app.integrations.session_cookie import sign_user_id
from app.main import app
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.repositories import user as user_repo
from app.schemas.job import JobStatus, JobType


def _cookies(owner_id: uuid.UUID) -> dict[str, str]:
    return {"amee_session": sign_user_id(owner_id)}


async def _create_project() -> tuple[uuid.UUID, dict[str, str]]:
    async with async_session_factory() as session:
        user = await user_repo.create_guest(session)
        project = await project_repo.create(
            session,
            owner_id=user.id,
            name="Cancel endpoint test",
            video_url="/files/projects/z/source.mp4",
        )
        return project.id, _cookies(user.id)


async def _create_job(
    project_id: uuid.UUID, *, job_type: JobType, status: JobStatus
) -> uuid.UUID:
    async with async_session_factory() as session:
        job = await job_repo.create(
            session, project_id=project_id, owner_id=uuid.uuid4(), job_type=job_type
        )
        if status != JobStatus.queued:
            await job_repo.update_status(session, job.id, status=status, progress=None)
        return job.id


async def _cancel(
    project_id: uuid.UUID, job_id: uuid.UUID, cookies: dict[str, str] | None = None
) -> httpx.Response:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        return await client.post(f"/api/v1/projects/{project_id}/jobs/{job_id}/cancel")


async def test_cancel_404s_for_missing_project() -> None:
    response = await _cancel(uuid.uuid4(), uuid.uuid4())
    assert response.status_code == 404


async def test_cancel_404s_for_missing_job() -> None:
    project_id, cookies = await _create_project()
    response = await _cancel(project_id, uuid.uuid4(), cookies)
    assert response.status_code == 404


async def test_cancel_owned_by_someone_else_is_not_found() -> None:
    """The IDOR/BOLA fix (require_project_owner) - a real project id that isn't the caller's own
    must read exactly like a nonexistent one."""
    project_id, _ = await _create_project()
    job_id = await _create_job(
        project_id, job_type=JobType.export, status=JobStatus.processing
    )

    response = await _cancel(project_id, job_id)

    assert response.status_code == 404


async def test_cancel_404s_when_job_belongs_to_a_different_project() -> None:
    project_a, _ = await _create_project()
    project_b, cookies_b = await _create_project()
    job_id = await _create_job(
        project_a, job_type=JobType.export, status=JobStatus.processing
    )

    response = await _cancel(project_b, job_id, cookies_b)

    assert response.status_code == 404


async def test_cancel_409s_for_transcribe_jobs() -> None:
    """Only export jobs are cancellable (contract §5) - not transcribe."""
    project_id, cookies = await _create_project()
    job_id = await _create_job(
        project_id, job_type=JobType.transcribe, status=JobStatus.processing
    )

    response = await _cancel(project_id, job_id, cookies)

    assert response.status_code == 409


async def test_cancel_409s_for_export_srt_jobs() -> None:
    """export_srt is near-instant text generation, not worth cancelling
    (contract §5)."""
    project_id, cookies = await _create_project()
    job_id = await _create_job(
        project_id, job_type=JobType.export_srt, status=JobStatus.processing
    )

    response = await _cancel(project_id, job_id, cookies)

    assert response.status_code == 409


async def test_cancel_409s_for_already_done_export() -> None:
    project_id, cookies = await _create_project()
    job_id = await _create_job(
        project_id, job_type=JobType.export, status=JobStatus.done
    )

    response = await _cancel(project_id, job_id, cookies)

    assert response.status_code == 409


async def test_cancel_409s_for_already_cancelled_export() -> None:
    project_id, cookies = await _create_project()
    job_id = await _create_job(
        project_id, job_type=JobType.export, status=JobStatus.cancelled
    )

    response = await _cancel(project_id, job_id, cookies)

    assert response.status_code == 409


async def test_cancel_succeeds_for_a_queued_export_with_no_pid_yet() -> None:
    """The job hasn't started real work - nothing to kill, but the cancel
    flag still gets set so _do_export's own early check catches it."""
    project_id, cookies = await _create_project()
    job_id = await _create_job(
        project_id, job_type=JobType.export, status=JobStatus.queued
    )

    response = await _cancel(project_id, job_id, cookies)

    assert response.status_code == 202
    assert response.json()["id"] == str(job_id)
    assert await redis_integration.is_export_cancel_requested(str(job_id)) is True


async def test_cancel_succeeds_and_requests_cancel_for_a_processing_export() -> None:
    project_id, cookies = await _create_project()
    job_id = await _create_job(
        project_id, job_type=JobType.export, status=JobStatus.processing
    )

    response = await _cancel(project_id, job_id, cookies)

    assert response.status_code == 202
    # 202 with the job as it stood at the instant of the call (contract §5)
    # - still "processing", the actual transition happens asynchronously.
    assert response.json()["status"] == "processing"
    assert await redis_integration.is_export_cancel_requested(str(job_id)) is True
