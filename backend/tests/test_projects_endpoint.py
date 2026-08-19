import uuid
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport

from app.db import async_session_factory
from app.integrations.session_cookie import sign_user_id
from app.main import app
from app.repositories import style as style_repo
from app.repositories import user as user_repo


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
        # Omitted `language` -> null, auto-detect (arch §2.9), unchanged
        # from today's behavior.
        assert created["language"] is None
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
        listing = list_response.json()
        assert any(p["id"] == project_id for p in listing["items"])
        assert listing["total"] >= 1

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


async def test_create_project_with_language_roundtrip(sample_video: Path) -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        with sample_video.open("rb") as f:
            create_response = await client.post(
                "/api/v1/projects",
                files={"file": ("sample.mp4", f, "video/mp4")},
                data={"language": "ru"},
            )
        assert create_response.status_code == 201
        created = create_response.json()
        assert created["language"] == "ru"

        get_response = await client.get(f"/api/v1/projects/{created['id']}")
        assert get_response.status_code == 200
        assert get_response.json()["language"] == "ru"


async def test_create_project_rejects_unsupported_extension(
    sample_video: Path,
) -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        with sample_video.open("rb") as f:
            response = await client.post(
                "/api/v1/projects",
                files={"file": ("sample.avi", f, "video/x-msvideo")},
            )
        assert response.status_code == 422
        body = response.json()
        assert body["error"]["code"] == "validation_error"
        assert body["error"]["details"][0]["field"] == "file"


async def test_create_project_accepts_mov_extension(sample_video: Path) -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        with sample_video.open("rb") as f:
            response = await client.post(
                "/api/v1/projects",
                files={"file": ("sample.mov", f, "video/quicktime")},
            )
        assert response.status_code == 201


async def test_create_project_rejects_oversized_file(
    sample_video: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Shrink the 100MB limit rather than uploading a real 100MB file.
    monkeypatch.setattr("app.services.projects._MAX_UPLOAD_BYTES", 10)
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        with sample_video.open("rb") as f:
            response = await client.post(
                "/api/v1/projects",
                files={"file": ("sample.mp4", f, "video/mp4")},
            )
        assert response.status_code == 422
        body = response.json()
        assert body["error"]["details"][0]["field"] == "file"
        assert "limit" in body["error"]["details"][0]["issue"]


async def test_create_project_enforces_the_per_owner_quota(
    sample_video: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The quota is User.projects_uploaded_count, not a live count of the caller's current
    projects - a bare upload never touches it (only a transcribe job reaching `done` does, see
    test_transcribe_task.py), so simulating "already used N slots" means bumping the counter
    directly rather than uploading N real videos."""
    monkeypatch.setattr("app.services.projects._MAX_PROJECTS_PER_OWNER", 2)
    async with async_session_factory() as session:
        owner = await user_repo.create_guest(session)
        await user_repo.increment_projects_uploaded(session, owner.id)
        await user_repo.increment_projects_uploaded(session, owner.id)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        cookies={"amee_session": sign_user_id(owner.id)},
    ) as client:
        with sample_video.open("rb") as f:
            over_cap = await client.post(
                "/api/v1/projects", files={"file": ("sample.mp4", f, "video/mp4")}
            )
        assert over_cap.status_code == 422
        body = over_cap.json()
        assert body["error"]["details"][0]["field"] == "quota"


async def test_deleting_a_transcribed_project_does_not_free_a_quota_slot(
    sample_video: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The whole point of a persisted counter instead of a live COUNT(*) on projects: upload,
    transcribe successfully, delete, repeat must not be a way around the cap."""
    monkeypatch.setattr("app.services.projects._MAX_PROJECTS_PER_OWNER", 1)
    async with async_session_factory() as session:
        owner = await user_repo.create_guest(session)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        cookies={"amee_session": sign_user_id(owner.id)},
    ) as client:
        with sample_video.open("rb") as f:
            created = await client.post(
                "/api/v1/projects", files={"file": ("sample.mp4", f, "video/mp4")}
            )
        assert created.status_code == 201
        project_id = created.json()["id"]

        # Simulates what the transcribe job itself does on success - test_transcribe_task.py
        # covers that path directly. This project's transcription counted toward the cap.
        async with async_session_factory() as session:
            await user_repo.increment_projects_uploaded(session, owner.id)

        delete_response = await client.delete(f"/api/v1/projects/{project_id}")
        assert delete_response.status_code == 204

        with sample_video.open("rb") as f:
            blocked = await client.post(
                "/api/v1/projects", files={"file": ("sample.mp4", f, "video/mp4")}
            )
    assert blocked.status_code == 422
    assert blocked.json()["error"]["details"][0]["field"] == "quota"


async def test_create_project_with_unsupported_language_returns_422(
    sample_video: Path,
) -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        with sample_video.open("rb") as f:
            response = await client.post(
                "/api/v1/projects",
                files={"file": ("sample.mp4", f, "video/mp4")},
                data={"language": "xx"},
            )
        assert response.status_code == 422
        body = response.json()
        assert body["error"]["code"] == "validation_error"
        assert body["error"]["details"][0]["field"] == "language"


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
