import httpx
from httpx import ASGITransport

from app.main import app


async def test_get_me_mints_a_guest_on_first_call() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/v1/auth/me")

        assert response.status_code == 200
        body = response.json()
        assert body["is_guest"] is True
        assert body["email"] is None
        assert "amee_session" in response.cookies


async def test_get_me_reuses_the_same_guest_across_calls() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        first = await client.get("/api/v1/auth/me")
        second = await client.get("/api/v1/auth/me")

        assert first.json()["id"] == second.json()["id"]


async def test_logout_clears_the_cookie() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.get("/api/v1/auth/me")
        assert "amee_session" in client.cookies

        response = await client.post("/api/v1/auth/logout")

        assert response.status_code == 204
        assert "amee_session" not in client.cookies


async def test_logout_with_no_session_at_all_still_succeeds() -> None:
    """No Depends(get_current_user_id) on this route on purpose - logging out must not mint a
    guest just to immediately clear its own cookie."""
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/api/v1/auth/logout")
        assert response.status_code == 204


async def test_a_new_session_after_logout_is_a_different_guest() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        before = await client.get("/api/v1/auth/me")
        await client.post("/api/v1/auth/logout")
        after = await client.get("/api/v1/auth/me")

        assert before.json()["id"] != after.json()["id"]
