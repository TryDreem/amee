import uuid

import httpx
from httpx import ASGITransport

from app.db import async_session_factory
from app.integrations.session_cookie import sign_user_id
from app.main import app
from app.repositories import project as project_repo
from app.repositories import user as user_repo


async def _create_project() -> tuple[str, dict[str, str]]:
    async with async_session_factory() as session:
        user = await user_repo.create_guest(session)
        project = await project_repo.create(
            session,
            owner_id=user.id,
            name="Open-tracking test",
            video_url="/files/projects/o/source.mp4",
        )
        return str(project.id), {"amee_session": sign_user_id(user.id)}


async def test_open_project_sets_last_opened_at() -> None:
    project_id, cookies = await _create_project()

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        response = await client.post(f"/api/v1/projects/{project_id}/open")

    assert response.status_code == 204

    async with async_session_factory() as session:
        project = await project_repo.get(session, uuid.UUID(project_id))
    assert project is not None
    assert project.last_opened_at is not None


async def test_open_project_404s_for_missing_project() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(f"/api/v1/projects/{uuid.uuid4()}/open")

    assert response.status_code == 404


async def test_open_project_owned_by_someone_else_is_not_found() -> None:
    """The IDOR/BOLA fix (require_project_owner) - a real project id that isn't the caller's own
    must read exactly like a nonexistent one, and must not have its last_opened_at touched."""
    project_id, _ = await _create_project()

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(f"/api/v1/projects/{project_id}/open")

    assert response.status_code == 404

    async with async_session_factory() as session:
        project = await project_repo.get(session, uuid.UUID(project_id))
    assert project is not None
    assert project.last_opened_at is None


async def test_get_project_does_not_set_last_opened_at() -> None:
    """D13: last_opened_at is written only by POST .../open, never as a side
    effect of GET /projects/{id} - a GET must stay side-effect-free so it
    can be cached later without silently breaking this tracking."""
    project_id, cookies = await _create_project()

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        response = await client.get(f"/api/v1/projects/{project_id}")

    assert response.status_code == 200
    assert response.json()["last_opened_at"] is None

    async with async_session_factory() as session:
        project = await project_repo.get(session, uuid.UUID(project_id))
    assert project is not None
    assert project.last_opened_at is None
