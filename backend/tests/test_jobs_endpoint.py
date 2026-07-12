import uuid

import httpx
from httpx import ASGITransport

from app.db import async_session_factory
from app.main import app
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.schemas.job import JobType


async def test_get_job_returns_created_job() -> None:
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="Jobs endpoint test",
            video_url="/files/projects/z/source.mp4",
            video_width=100,
            video_height=100,
            video_duration_seconds=1.0,
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
