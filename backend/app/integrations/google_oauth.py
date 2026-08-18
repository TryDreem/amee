"""Google OAuth 2.0 authorization-code flow — the two outbound HTTP calls only.

Deliberately narrow, matching `llm_split.py`'s convention: this module builds the authorize URL
and exchanges a code for a profile. It knows nothing about cookies, sessions, users, or the
database — `app/services/auth.py` owns all of that. Swapping providers later would be confined
to this file.

Why authorization-code and not implicit/token: the client secret never leaves the server and the
access token never reaches the browser. The only thing that transits the user agent is a
short-lived, single-use `code` that is worthless without the secret.
"""

import os
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
_TIMEOUT_SECONDS = 15.0

# `openid email profile` is the minimum that yields a stable subject id, an email, and a
# display name/picture. Nothing here requests any Google API scope beyond identity - this app
# never reads the user's Drive, calendar, or anything else, and asking for more would show a
# scarier consent screen for no gain.
_SCOPE = "openid email profile"


class GoogleOAuthError(RuntimeError):
    """Any failure to complete the flow: missing configuration, HTTP/timeout error, non-200
    from Google, or a response missing the fields identity depends on."""


@dataclass(frozen=True)
class GoogleProfile:
    """Only the fields this app stores. `sub` is Google's stable per-account identifier and the
    only correct lookup key - `email` can change on Google's side for the same account, so
    keying on it would silently create a duplicate user the day someone renames their address."""

    sub: str
    email: str | None
    name: str | None
    picture: str | None


def _client_id() -> str:
    try:
        return os.environ["AMEE_GOOGLE_CLIENT_ID"]
    except KeyError as exc:
        raise GoogleOAuthError(
            "AMEE_GOOGLE_CLIENT_ID environment variable is not set"
        ) from exc


def _client_secret() -> str:
    try:
        return os.environ["AMEE_GOOGLE_CLIENT_SECRET"]
    except KeyError as exc:
        raise GoogleOAuthError(
            "AMEE_GOOGLE_CLIENT_SECRET environment variable is not set"
        ) from exc


def authorize_url(*, redirect_uri: str, state: str) -> str:
    """The URL to 302 the browser to. `state` is the caller's CSRF token, echoed back by Google
    on the callback for the caller to verify."""
    query = urlencode(
        {
            "client_id": _client_id(),
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": _SCOPE,
            "state": state,
            # Without this Google silently returns no profile at all for an account that has
            # already consented once, which reads as "OAuth randomly stopped working".
            "prompt": "select_account",
        }
    )
    return f"{_AUTHORIZE_URL}?{query}"


async def exchange_code(*, code: str, redirect_uri: str) -> GoogleProfile:
    """Trades the one-time `code` for an access token, then fetches the profile it grants.

    Two round trips rather than decoding the returned `id_token` JWT locally: verifying a JWT
    correctly means fetching and caching Google's rotating public keys and checking signature,
    issuer, audience and expiry - a second HTTP call to a Google-authenticated endpoint gets the
    same data with no crypto to get subtly wrong. This runs once per sign-in, not per request,
    so the extra round trip costs nothing that matters.
    """
    token_body = {
        "code": code,
        "client_id": _client_id(),
        "client_secret": _client_secret(),
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            token_response = await client.post(_TOKEN_URL, data=token_body)
            token_response.raise_for_status()
            access_token = token_response.json()["access_token"]

            userinfo_response = await client.get(
                _USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}
            )
            userinfo_response.raise_for_status()
            profile = userinfo_response.json()
    except httpx.HTTPError as exc:
        raise GoogleOAuthError(f"request to Google failed: {exc}") from exc
    except (KeyError, ValueError) as exc:
        raise GoogleOAuthError(f"malformed response from Google: {exc}") from exc

    sub = profile.get("sub")
    if not isinstance(sub, str) or not sub:
        raise GoogleOAuthError("Google profile is missing the `sub` identifier")

    return GoogleProfile(
        sub=sub,
        email=profile.get("email"),
        name=profile.get("name"),
        picture=profile.get("picture"),
    )
