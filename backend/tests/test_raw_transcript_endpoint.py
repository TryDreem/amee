import uuid

import httpx
from httpx import ASGITransport

from app.db import async_session_factory
from app.integrations.session_cookie import sign_user_id
from app.main import app
from app.repositories import project as project_repo
from app.repositories import raw_transcript as raw_transcript_repo
from app.repositories import user as user_repo


async def _make_owner() -> uuid.UUID:
    async with async_session_factory() as session:
        user = await user_repo.create_guest(session)
    return user.id


def _cookies(owner_id: uuid.UUID) -> dict[str, str]:
    return {"amee_session": sign_user_id(owner_id)}


async def test_get_raw_transcript_not_found_before_transcription() -> None:
    owner_id = await _make_owner()
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=owner_id,
            name="Raw transcript endpoint test",
            video_url="/files/projects/z/source.mp4",
        )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        cookies=_cookies(owner_id),
    ) as client:
        response = await client.get(f"/api/v1/projects/{project.id}/raw-transcript")

        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"


async def test_get_raw_transcript_returns_persisted_words() -> None:
    words = [{"text": "hi", "start": 0.0, "end": 0.3}]
    owner_id = await _make_owner()

    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=owner_id,
            name="Raw transcript endpoint test 2",
            video_url="/files/projects/z/source.mp4",
        )
        await raw_transcript_repo.create(
            session, project_id=project.id, owner_id=project.owner_id, words=words
        )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        cookies=_cookies(owner_id),
    ) as client:
        response = await client.get(f"/api/v1/projects/{project.id}/raw-transcript")

        assert response.status_code == 200
        body = response.json()
        assert body["project_id"] == str(project.id)
        assert body["words"] == words


async def test_get_raw_transcript_owned_by_someone_else_is_not_found() -> None:
    """The IDOR/BOLA fix (require_project_owner) - a real project id that isn't the caller's own
    must read exactly like a nonexistent one."""
    owner_id = await _make_owner()
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=owner_id,
            name="Someone else's raw transcript",
            video_url="/files/projects/z/source.mp4",
        )
        await raw_transcript_repo.create(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            words=[{"text": "hi", "start": 0.0, "end": 0.3}],
        )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/v1/projects/{project.id}/raw-transcript")

    assert response.status_code == 404
