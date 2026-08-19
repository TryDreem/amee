from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import patch

import httpx
import pytest

from app.integrations.google_oauth import (
    GoogleOAuthError,
    authorize_url,
    exchange_code,
)

_ENV = {
    "AMEE_GOOGLE_CLIENT_ID": "test-client-id",
    "AMEE_GOOGLE_CLIENT_SECRET": "test-client-secret",
}


@contextmanager
def _mocked_transport(
    handler: Callable[[httpx.Request], httpx.Response],
) -> Iterator[None]:
    original_init = httpx.AsyncClient.__init__

    def patched_init(self: httpx.AsyncClient, *args: Any, **kwargs: Any) -> None:
        kwargs["transport"] = httpx.MockTransport(handler)
        original_init(self, *args, **kwargs)

    with (
        patch.dict("os.environ", _ENV),
        patch.object(httpx.AsyncClient, "__init__", patched_init),
    ):
        yield


def test_authorize_url_carries_the_state_and_redirect_uri() -> None:
    with patch.dict("os.environ", _ENV):
        url = authorize_url(redirect_uri="http://x/cb", state="s3cr3t")

    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "state=s3cr3t" in url
    assert "redirect_uri=http%3A%2F%2Fx%2Fcb" in url
    assert "response_type=code" in url
    # Identity only - this app never asks for Drive/calendar/anything else.
    assert "scope=openid+email+profile" in url


def test_authorize_url_without_configuration_raises_google_oauth_error() -> None:
    with (
        patch.dict("os.environ", {}, clear=True),
        pytest.raises(GoogleOAuthError, match="AMEE_GOOGLE_CLIENT_ID"),
    ):
        authorize_url(redirect_uri="http://x/cb", state="s")


async def test_exchange_code_returns_the_profile() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": "at-123"})
        assert request.headers["Authorization"] == "Bearer at-123"
        return httpx.Response(
            200,
            json={
                "sub": "google-sub-1",
                "email": "a@example.com",
                "name": "Alice",
                "picture": "https://img/a.png",
            },
        )

    with _mocked_transport(handler):
        profile = await exchange_code(code="c", redirect_uri="http://x/cb")

    assert profile.sub == "google-sub-1"
    assert profile.email == "a@example.com"
    assert profile.name == "Alice"
    assert profile.picture == "https://img/a.png"


async def test_exchange_code_sends_the_secret_and_the_code() -> None:
    """The client secret must travel in the server-to-server token request — never anywhere the
    browser can see it. Asserting on the outbound body is the only way to catch a refactor that
    quietly drops it."""
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/token"):
            for pair in request.content.decode().split("&"):
                key, _, value = pair.partition("=")
                seen[key] = value
            return httpx.Response(200, json={"access_token": "at"})
        return httpx.Response(200, json={"sub": "s"})

    with _mocked_transport(handler):
        await exchange_code(code="the-code", redirect_uri="http://x/cb")

    assert seen["code"] == "the-code"
    assert seen["client_secret"] == "test-client-secret"
    assert seen["grant_type"] == "authorization_code"


async def test_exchange_code_wraps_transport_failures() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom")

    with (
        _mocked_transport(handler),
        pytest.raises(GoogleOAuthError, match="request to Google failed"),
    ):
        await exchange_code(code="c", redirect_uri="http://x/cb")


async def test_exchange_code_rejects_a_non_200_from_google() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "invalid_grant"})

    with _mocked_transport(handler), pytest.raises(GoogleOAuthError):
        await exchange_code(code="expired", redirect_uri="http://x/cb")


async def test_exchange_code_rejects_a_profile_with_no_sub() -> None:
    """`sub` is the only stable lookup key — a profile without it must fail loudly rather than
    silently producing a user keyed on None."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": "at"})
        return httpx.Response(200, json={"email": "a@example.com"})

    with (
        _mocked_transport(handler),
        pytest.raises(GoogleOAuthError, match="missing the `sub`"),
    ):
        await exchange_code(code="c", redirect_uri="http://x/cb")
