"""POST /auth/me/avatar — profile photo upload. Validation mirrors services/projects.py's own
extension/size checks (same DomainValidationError -> 422 shape), just with tighter limits since
this is a photo, not a source video."""

import httpx
from httpx import ASGITransport

from app.integrations import storage
from app.main import app

_PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


async def test_update_avatar_sets_avatar_url_and_persists() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/auth/me/avatar",
            files={"file": ("photo.png", _PNG_BYTES, "image/png")},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["avatar_url"] is not None
        assert body["avatar_url"].endswith("/avatar.png")

        me = await client.get("/api/v1/auth/me")
        assert me.json()["avatar_url"] == body["avatar_url"]


async def test_update_avatar_rejects_unsupported_extension() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/auth/me/avatar",
            files={"file": ("photo.txt", b"not an image", "text/plain")},
        )

        assert response.status_code == 422


async def test_update_avatar_rejects_oversized_file() -> None:
    oversized = b"\x00" * (5 * 1024**2 + 1)
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/auth/me/avatar",
            files={"file": ("photo.png", oversized, "image/png")},
        )

        assert response.status_code == 422


async def test_update_avatar_overwrites_previous_file_on_disk() -> None:
    """A second upload with a different extension must not leave the first file behind — same
    directory, same user, only the latest avatar.* should exist afterward."""
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        first = await client.post(
            "/api/v1/auth/me/avatar",
            files={"file": ("photo.jpg", _PNG_BYTES, "image/jpeg")},
        )
        user_id = first.json()["id"]

        second = await client.post(
            "/api/v1/auth/me/avatar",
            files={"file": ("photo.png", _PNG_BYTES, "image/png")},
        )

        assert second.json()["avatar_url"].endswith("/avatar.png")
        remaining = list((storage.storage_dir() / "users" / user_id).glob("avatar.*"))
        assert [p.name for p in remaining] == ["avatar.png"]


async def test_update_avatar_with_no_prior_session_mints_a_guest() -> None:
    """No cookie sent at all - get_current_user_id mints a fresh guest inline, same as every
    other route behind that dependency, and the upload still succeeds against it."""
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/auth/me/avatar",
            files={"file": ("photo.png", _PNG_BYTES, "image/png")},
        )

        assert response.status_code == 200
        assert "amee_session" in response.cookies
