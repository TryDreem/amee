import uuid
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport

from app.main import app


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
        assert created["video_width"] == 320
        assert created["video_height"] == 240
        assert created["video_duration_seconds"] == pytest.approx(1.0, abs=0.2)
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
