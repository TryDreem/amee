"""HMAC-signed session cookie — no `sessions` table, no third-party dependency.

The cookie value carries the user id directly, signed against a server secret:
`{user_id}.{hmac_sha256_hex}`. Verifying it is pure CPU (no DB round trip); whether the id still
resolves to a real row is checked by the caller (app/api/v1/deps.py::get_current_user_id), not
here — this module only proves "was this value minted by us and left untouched."

Accepted, deliberate limitation: a single session cannot be revoked without rotating
AMEE_SESSION_SECRET, which logs out everyone at once. This project has no "active sessions" UI
concept and guest sessions are meant to be indefinite (confirmed decision) — the trade is right
for now, not an oversight.
"""

import hashlib
import hmac
import os
import uuid

_SEPARATOR = "."


class InvalidSessionCookie(ValueError):
    pass


def _secret() -> bytes:
    return os.environ["AMEE_SESSION_SECRET"].encode("utf-8")


def sign_user_id(user_id: uuid.UUID) -> str:
    payload = str(user_id)
    signature = hmac.new(_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}{_SEPARATOR}{signature}"


def verify_cookie(value: str) -> uuid.UUID | None:
    """None on anything wrong — missing separator, tampered signature, malformed UUID. Never
    raises: the caller's job is "is there a valid session," not "why isn't there one." """
    payload, _, signature = value.partition(_SEPARATOR)
    if not signature:
        return None
    expected = hmac.new(_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        return uuid.UUID(payload)
    except ValueError:
        return None
