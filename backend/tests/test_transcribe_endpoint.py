import uuid
from pathlib import Path

import httpx
from httpx import ASGITransport

from app.db import async_session_factory
from app.integrations import storage
from app.integrations.session_cookie import sign_user_id
from app.main import app
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.repositories import user as user_repo
from app.schemas.job import JobStatus, JobType

# No eager_celery fixture here on purpose: transcribe_task's own
# asyncio.run() (app/workers/tasks.py) can't run nested inside the async
# FastAPI route handler's own event loop, which is exactly the context
# these tests call it from. `.delay()` here really publishes to the real
# RabbitMQ broker and returns immediately without executing the task body —
# the actual 4-branch pipeline is exercised directly, from plain sync test
# functions, in test_transcribe_task.py.


async def _create_project(sample_video: Path) -> tuple[uuid.UUID, dict[str, str]]:
    async with async_session_factory() as session:
        owner = await user_repo.create_guest(session)
        project_id = uuid.uuid4()
        _, video_url = await storage.save_video(
            project_id, "sample.mp4", sample_video.read_bytes()
        )
        project = await project_repo.create(
            session,
            project_id=project_id,
            owner_id=owner.id,
            name="Transcribe endpoint test",
            video_url=video_url,
        )
        return project.id, {"amee_session": sign_user_id(owner.id)}


async def test_transcribe_returns_404_for_missing_project() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(f"/api/v1/projects/{uuid.uuid4()}/transcribe")
        assert response.status_code == 404


async def test_transcribe_owned_by_someone_else_is_not_found(
    sample_video: Path,
) -> None:
    """The IDOR/BOLA fix (require_project_owner) - a real project id that isn't the caller's own
    must read exactly like a nonexistent one."""
    project_id, _ = await _create_project(sample_video)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(f"/api/v1/projects/{project_id}/transcribe")

    assert response.status_code == 404


async def test_transcribe_enqueues_job_and_returns_202(sample_video: Path) -> None:
    project_id, cookies = await _create_project(sample_video)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        response = await client.post(f"/api/v1/projects/{project_id}/transcribe")

    assert response.status_code == 202
    body = response.json()
    assert body["project_id"] == str(project_id)
    assert body["type"] == "transcribe"
    assert body["status"] == "queued"
    assert body["progress"] is None
    assert body["thumbnail_url"] is None


async def test_transcribe_returns_409_when_already_queued_or_processing(
    sample_video: Path,
) -> None:
    project_id, cookies = await _create_project(sample_video)
    async with async_session_factory() as session:
        project = await project_repo.get(session, project_id)
        assert project is not None
        await job_repo.create(
            session,
            project_id=project_id,
            owner_id=project.owner_id,
            job_type=JobType.transcribe,
        )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        response = await client.post(f"/api/v1/projects/{project_id}/transcribe")

    assert response.status_code == 409


async def test_transcribe_allowed_again_after_a_failed_job(
    sample_video: Path,
) -> None:
    project_id, cookies = await _create_project(sample_video)
    async with async_session_factory() as session:
        project = await project_repo.get(session, project_id)
        assert project is not None
        failed_job = await job_repo.create(
            session,
            project_id=project_id,
            owner_id=project.owner_id,
            job_type=JobType.transcribe,
        )
        await job_repo.update_status(
            session, failed_job.id, status=JobStatus.failed, error="boom"
        )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        response = await client.post(f"/api/v1/projects/{project_id}/transcribe")

    # A prior failed job doesn't count against the once-per-video budget
    # (P2, contract §4) — this should enqueue a new job, not 409.
    assert response.status_code == 202
