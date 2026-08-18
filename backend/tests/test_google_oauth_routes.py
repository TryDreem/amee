"""GET /auth/google/start and /auth/google/callback — the redirect/CSRF wiring.

Google's own endpoints are mocked (tests/test_google_oauth.py covers the HTTP contract itself);
what's under test here is that the state cookie is minted, required, and compared, and that
every failure path lands the browser back on the frontend rather than on an API error page.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import patch

import httpx
from httpx import ASGITransport

from app.main import app

_ENV = {
    "AMEE_GOOGLE_CLIENT_ID": "test-client-id",
    "AMEE_GOOGLE_CLIENT_SECRET": "test-client-secret",
    "AMEE_FRONTEND_ORIGIN": "http://frontend.test",
}


@contextmanager
def _mocked_google(sub: str = "google-sub-route") -> Iterator[None]:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": "at"})
        return httpx.Response(
            200, json={"sub": sub, "email": "r@example.com", "name": "R"}
        )

    original_init = httpx.AsyncClient.__init__

    def patched_init(self: httpx.AsyncClient, *args: Any, **kwargs: Any) -> None:
        # Only patch calls going out to Google; the test's own ASGI client passes its transport
        # explicitly, so leave that one alone.
        if "transport" not in kwargs:
            kwargs["transport"] = httpx.MockTransport(handler)
        original_init(self, *args, **kwargs)

    with (
        patch.dict("os.environ", _ENV),
        patch.object(httpx.AsyncClient, "__init__", patched_init),
    ):
        yield


@contextmanager
def _env_only() -> Iterator[None]:
    with patch.dict("os.environ", _ENV):
        yield


async def test_start_redirects_to_google_and_sets_a_state_cookie() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        with _env_only():
            response = await client.get("/api/v1/auth/google/start")

    assert response.status_code == 307
    assert response.headers["location"].startswith(
        "https://accounts.google.com/o/oauth2/v2/auth?"
    )
    assert "amee_oauth_state" in response.cookies
    # The state in the cookie has to be the same one Google will echo back.
    assert (
        f"state={response.cookies['amee_oauth_state']}" in response.headers["location"]
    )


async def test_callback_without_a_state_cookie_is_refused() -> None:
    """A crafted callback URL sent to a victim who never started a flow here — the whole reason
    the state cookie exists."""
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        with _mocked_google():
            response = await client.get(
                "/api/v1/auth/google/callback?code=c&state=attacker-chosen"
            )

    assert response.status_code == 307
    assert (
        response.headers["location"]
        == "http://frontend.test/?auth_error=invalid_request"
    )


async def test_callback_with_a_mismatched_state_is_refused() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        with _mocked_google():
            await client.get("/api/v1/auth/google/start")
            response = await client.get(
                "/api/v1/auth/google/callback?code=c&state=not-the-one-we-issued"
            )

    assert (
        response.headers["location"]
        == "http://frontend.test/?auth_error=state_mismatch"
    )


async def test_callback_when_the_user_cancels_on_google_lands_back_on_the_frontend() -> (
    None
):
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        with _mocked_google():
            await client.get("/api/v1/auth/google/start")
            response = await client.get(
                "/api/v1/auth/google/callback?error=access_denied"
            )

    assert response.headers["location"] == "http://frontend.test/?auth_error=cancelled"


async def test_full_flow_signs_the_browser_in() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        with _mocked_google(sub="google-sub-full-flow"):
            start = await client.get("/api/v1/auth/google/start")
            state = start.cookies["amee_oauth_state"]
            callback = await client.get(
                f"/api/v1/auth/google/callback?code=the-code&state={state}"
            )

            assert callback.status_code == 307
            assert callback.headers["location"] == "http://frontend.test"

            me = await client.get("/api/v1/auth/me")

    body = me.json()
    assert body["is_guest"] is False
    assert body["email"] == "r@example.com"


async def test_a_guests_session_becomes_the_signed_in_account() -> None:
    """The browser arrives at the callback already carrying a guest cookie; afterwards the same
    browser must be the real account, not still the guest."""
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        guest = await client.get("/api/v1/auth/me")
        assert guest.json()["is_guest"] is True

        with _mocked_google(sub="google-sub-upgrade"):
            start = await client.get("/api/v1/auth/google/start")
            await client.get(
                f"/api/v1/auth/google/callback"
                f"?code=c&state={start.cookies['amee_oauth_state']}"
            )
            after = await client.get("/api/v1/auth/me")

    assert after.json()["is_guest"] is False
    # Promoted in place — same row, so nothing they made as a guest had to move.
    assert after.json()["id"] == guest.json()["id"]
