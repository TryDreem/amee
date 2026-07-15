import uuid
from pathlib import Path

import httpx
from httpx import ASGITransport

from app.db import async_session_factory
from app.main import app
from app.repositories import style as style_repo


async def test_create_list_get_project_roundtrip(sample_video: Path) -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        with sample_video.open("rb") as f:
            create_response = await client.post(
                "/api/v1/projects",
                files={"file": ("sample.mp4", f, "video/mp4")},
                data={"name": "My Project"},
            )

        assert create_response.status_code == 201
        created = create_response.json()
        assert created["name"] == "My Project"
        # Upload only saves the file (arch §2.8) — no ffmpeg on the request
        # path, so these all start null and are filled in later by the
        # transcribe job.
        assert created["video_width"] is None
        assert created["video_height"] is None
        assert created["video_duration_seconds"] is None
        assert created["thumbnail_url"] is None
        assert created["preview_video_url"] is None
        assert created["video_url"].startswith(f"/files/projects/{created['id']}/")
        assert created["latest_transcribe_job_id"] is None
        assert created["export_job_ids"] == []
        project_id = created["id"]

        list_response = await client.get("/api/v1/projects")
        assert list_response.status_code == 200
        assert any(p["id"] == project_id for p in list_response.json())

        get_response = await client.get(f"/api/v1/projects/{project_id}")
        assert get_response.status_code == 200
        assert get_response.json() == created

        file_response = await client.get(created["video_url"])
        assert file_response.status_code == 200

    # CaptionStyleSpec is initialized immediately on upload (contract §4) -
    # GET /style isn't wired yet (M2 step 3), so check the repo directly.
    async with async_session_factory() as session:
        style = await style_repo.get(session, uuid.UUID(project_id))
    assert style is not None
    assert style.overrides == {}


async def test_get_project_not_found() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/v1/projects/{uuid.uuid4()}")

        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"


async def test_get_project_bad_uuid_returns_422() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/v1/projects/not-a-uuid")

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"
