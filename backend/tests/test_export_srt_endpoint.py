import uuid
from pathlib import Path
from typing import Any

import httpx
from httpx import ASGITransport

from app.db import async_session_factory
from app.integrations import storage
from app.integrations.session_cookie import sign_user_id
from app.integrations.whisperx import TranscribedWord
from app.main import app
from app.repositories import project as project_repo
from app.repositories import user as user_repo
from app.services import ecs as ecs_service
from app.services import style as style_service

_DEFAULT_PRESET_ID = "c1a1a1a1-0000-4000-8000-000000000001"

# No eager_celery fixture here on purpose - same reason as
# test_export_endpoint.py: export_srt_task's own asyncio.run() can't run
# nested inside the async route handler's event loop. The actual rendering
# is exercised from plain sync test functions in test_export_srt_task.py.


async def _create_project(sample_video: Path) -> tuple[uuid.UUID, dict[str, str]]:
    async with async_session_factory() as session:
        owner = await user_repo.create_guest(session)
        project_id = uuid.uuid4()
        _, video_url = storage.save_video(
            project_id, "sample.mp4", sample_video.read_bytes()
        )
        project = await project_repo.create(
            session,
            project_id=project_id,
            owner_id=owner.id,
            name="Export SRT endpoint test",
            video_url=video_url,
        )
        await style_service.create_default_style(
            session, project_id=project.id, owner_id=project.owner_id
        )
        return project.id, {"amee_session": sign_user_id(owner.id)}


def _valid_body() -> dict[str, Any]:
    return {
        "ecs": {
            "segments": [
                {
                    "id": str(uuid.uuid4()),
                    "words": [
                        {
                            "id": str(uuid.uuid4()),
                            "text": "hi",
                            "start": 0.0,
                            "end": 0.3,
                        }
                    ],
                }
            ]
        },
        "style": {"presetId": _DEFAULT_PRESET_ID, "overrides": {}},
    }


async def test_export_srt_returns_404_for_missing_project() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            f"/api/v1/projects/{uuid.uuid4()}/export-srt", json=_valid_body()
        )
        assert response.status_code == 404


async def test_export_srt_owned_by_someone_else_is_not_found(
    sample_video: Path,
) -> None:
    """The IDOR/BOLA fix (require_project_owner) - a real project id that isn't the caller's own
    must read exactly like a nonexistent one."""
    project_id, _ = await _create_project(sample_video)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            f"/api/v1/projects/{project_id}/export-srt", json=_valid_body()
        )

    assert response.status_code == 404


async def test_export_srt_enqueues_job_and_returns_202(sample_video: Path) -> None:
    project_id, cookies = await _create_project(sample_video)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        response = await client.post(
            f"/api/v1/projects/{project_id}/export-srt", json=_valid_body()
        )

    assert response.status_code == 202
    body = response.json()
    assert body["project_id"] == str(project_id)
    assert body["type"] == "export_srt"
    assert body["status"] == "queued"


async def test_export_srt_does_not_persist_ecs_or_style(sample_video: Path) -> None:
    """The inverse of test_export_persists_ecs_and_style_before_enqueueing:
    POST /export-srt reads the submitted body but never writes it back -
    GET /ecs and GET /style must still reflect what was there before the
    call, not the submitted body."""
    async with async_session_factory() as session:
        owner = await user_repo.create_guest(session)
        project_id = uuid.uuid4()
        _, video_url = storage.save_video(
            project_id, "sample.mp4", sample_video.read_bytes()
        )
        project = await project_repo.create(
            session,
            project_id=project_id,
            owner_id=owner.id,
            name="Export SRT persistence test",
            video_url=video_url,
        )
        await style_service.create_default_style(
            session, project_id=project.id, owner_id=project.owner_id
        )
        await ecs_service.create_initial_ecs(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            words=[TranscribedWord(text="original", start=0.0, end=0.3)],
        )

    body = _valid_body()
    body["ecs"]["segments"][0]["words"][0]["text"] = "submitted-but-unsaved"
    body["style"]["overrides"] = {"fontSize": 0.05}

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        cookies={"amee_session": sign_user_id(owner.id)},
    ) as client:
        response = await client.post(
            f"/api/v1/projects/{project_id}/export-srt", json=body
        )
        assert response.status_code == 202

        ecs_response = await client.get(f"/api/v1/projects/{project_id}/ecs")
        style_response = await client.get(f"/api/v1/projects/{project_id}/style")

    assert ecs_response.json()["segments"][0]["words"][0]["text"] == "original"
    assert style_response.json()["overrides"] == {}


async def test_export_srt_out_of_bounds_style_returns_422(sample_video: Path) -> None:
    project_id, cookies = await _create_project(sample_video)
    body = _valid_body()
    body["style"] = {
        "presetId": _DEFAULT_PRESET_ID,
        "overrides": {"verticalPosition": 1.5},
    }

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        response = await client.post(
            f"/api/v1/projects/{project_id}/export-srt", json=body
        )

    assert response.status_code == 422
    details = response.json()["error"]["details"]
    assert details[0]["field"] == "overrides.verticalPosition"


async def test_export_srt_out_of_bounds_ecs_segment_override_returns_422(
    sample_video: Path,
) -> None:
    project_id, cookies = await _create_project(sample_video)
    body = _valid_body()
    body["ecs"]["segments"][0]["overrides"] = {"verticalPosition": 1.5}

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        response = await client.post(
            f"/api/v1/projects/{project_id}/export-srt", json=body
        )

    assert response.status_code == 422
    details = response.json()["error"]["details"]
    assert details[0]["field"] == "segments[0].overrides.verticalPosition"


async def test_export_srt_duplicate_word_id_returns_422(sample_video: Path) -> None:
    project_id, cookies = await _create_project(sample_video)
    body = _valid_body()
    dup_id = body["ecs"]["segments"][0]["words"][0]["id"]
    body["ecs"]["segments"][0]["words"].append(
        {"id": dup_id, "text": "again", "start": 0.4, "end": 0.6}
    )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        response = await client.post(
            f"/api/v1/projects/{project_id}/export-srt", json=body
        )

    assert response.status_code == 422
