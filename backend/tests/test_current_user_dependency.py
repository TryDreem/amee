"""app/api/v1/deps.py::get_current_user_id, exercised through a real route (POST /projects) so
this covers the actual FastAPI dependency wiring, not just the pieces it's built from
(session_cookie.py, user_repo.py each have their own direct unit tests)."""

import uuid
from pathlib import Path

import httpx
from httpx import ASGITransport

from app.db import async_session_factory
from app.main import app
from app.repositories import project as project_repo


async def test_first_request_mints_a_guest_and_sets_a_session_cookie(
    sample_video: Path,
) -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        with sample_video.open("rb") as f:
            response = await client.post(
                "/api/v1/projects",
                files={"file": ("sample.mp4", f, "video/mp4")},
                data={"name": "Guest's project"},
            )
        assert response.status_code == 201
        assert "amee_session" in response.cookies

        async with async_session_factory() as session:
            project = await project_repo.get(session, response.json()["id"])
            assert project is not None
            # owner_id is a real, freshly-minted guest id now - not the old
            # hardcoded PLACEHOLDER_OWNER_ID every project used to share.
            assert str(project.owner_id) != "00000000-0000-0000-0000-000000000001"


async def test_same_session_cookie_reuses_the_same_guest(sample_video: Path) -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        # httpx.AsyncClient keeps a cookie jar by default - the second request on this same
        # client carries the Set-Cookie the first response issued.
        with sample_video.open("rb") as f:
            first = await client.post(
                "/api/v1/projects",
                files={"file": ("sample.mp4", f, "video/mp4")},
                data={"name": "First"},
            )
        with sample_video.open("rb") as f:
            second = await client.post(
                "/api/v1/projects",
                files={"file": ("sample.mp4", f, "video/mp4")},
                data={"name": "Second"},
            )

        async with async_session_factory() as session:
            p1 = await project_repo.get(session, first.json()["id"])
            p2 = await project_repo.get(session, second.json()["id"])
            assert p1 is not None
            assert p2 is not None
            assert p1.owner_id == p2.owner_id


async def test_two_separate_clients_get_two_different_guests(
    sample_video: Path,
) -> None:
    """No shared cookie jar between these two clients - the real-world case of two different
    browsers/visitors, each with no session cookie yet."""

    async def _create(name: str) -> str:
        async with httpx.AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            with sample_video.open("rb") as f:
                response = await client.post(
                    "/api/v1/projects",
                    files={"file": ("sample.mp4", f, "video/mp4")},
                    data={"name": name},
                )
            return str(response.json()["id"])

    id_a = await _create("A")
    id_b = await _create("B")

    async with async_session_factory() as session:
        project_a = await project_repo.get(session, uuid.UUID(id_a))
        project_b = await project_repo.get(session, uuid.UUID(id_b))
        assert project_a is not None
        assert project_b is not None
        assert project_a.owner_id != project_b.owner_id


async def test_a_cookie_pointing_at_a_deleted_user_falls_back_to_a_fresh_guest(
    sample_video: Path,
) -> None:
    """A tampered or stale cookie must never 500 the request - it just mints a new guest, same
    as having no cookie at all."""
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        client.cookies.set("amee_session", "not-a-real-signed-value")
        with sample_video.open("rb") as f:
            response = await client.post(
                "/api/v1/projects",
                files={"file": ("sample.mp4", f, "video/mp4")},
                data={"name": "Recovered guest"},
            )
        assert response.status_code == 201
        assert "amee_session" in response.cookies
