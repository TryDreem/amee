"""Rate limiting: the fixed-window counter itself (app/integrations/rate_limit.py) plus its three
wirings (blanket per-IP, per-IP upload, per-user action) and the 429 envelope api-contract.md §1
already fixed. httpx's ASGITransport gives every request in these tests the same fake client IP -
conftest.py's autouse Redis flush is what keeps that from leaking between test functions."""

import uuid
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport

from app.db import async_session_factory
from app.integrations import rate_limit
from app.integrations.session_cookie import sign_user_id
from app.main import app
from app.repositories import user as user_repo


async def _make_owner() -> uuid.UUID:
    """A real row, not a bare uuid4() - get_current_user_id falls back to minting a fresh guest
    whenever a cookie's id doesn't resolve to an existing user, so a made-up id would silently
    become a *different* owner_id on every single request instead of the same one."""
    async with async_session_factory() as session:
        user = await user_repo.create_guest(session)
    return user.id


async def test_check_allows_up_to_the_limit_then_blocks() -> None:
    key = f"test:{uuid.uuid4()}"
    results = [
        await rate_limit.check(key, limit=3, window_seconds=60) for _ in range(4)
    ]

    assert [r.allowed for r in results] == [True, True, True, False]
    assert results[-1].remaining == 0


async def test_check_reports_decreasing_remaining() -> None:
    key = f"test:{uuid.uuid4()}"
    first = await rate_limit.check(key, limit=5, window_seconds=60)
    second = await rate_limit.check(key, limit=5, window_seconds=60)

    assert first.remaining == 4
    assert second.remaining == 3


async def test_check_fails_open_when_redis_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("AMEE_REDIS_URL", raising=False)
    key = f"test:{uuid.uuid4()}"

    status = await rate_limit.check(key, limit=1, window_seconds=60)

    assert status.allowed is True


async def test_upload_ip_limit_returns_the_fixed_429_shape(
    sample_video: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.api.v1.deps._IP_UPLOAD_LIMIT", 1)
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        with sample_video.open("rb") as f:
            first = await client.post(
                "/api/v1/projects", files={"file": ("sample.mp4", f, "video/mp4")}
            )
        assert first.status_code == 201

        with sample_video.open("rb") as f:
            second = await client.post(
                "/api/v1/projects", files={"file": ("sample.mp4", f, "video/mp4")}
            )

    assert second.status_code == 429
    assert second.headers["Retry-After"].isdigit()
    assert second.headers["X-RateLimit-Limit"] == "1"
    assert second.headers["X-RateLimit-Remaining"] == "0"
    body = second.json()
    assert body["error"]["code"] == "rate_limited"
    assert body["error"]["details"][0]["field"] == "ip"


async def test_user_action_limit_blocks_after_the_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.api.v1.deps._USER_ACTION_LIMIT", 1)
    owner_id = await _make_owner()
    cookies = {"amee_session": sign_user_id(owner_id)}
    # A real project isn't needed - the rate-limit dependency runs before the route body, so a
    # 404 from a made-up project_id still counts against the limit.
    fake_project_id = uuid.uuid4()

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        first = await client.post(f"/api/v1/projects/{fake_project_id}/transcribe")
        assert first.status_code != 429

        second = await client.post(f"/api/v1/projects/{fake_project_id}/transcribe")

    assert second.status_code == 429
    assert second.json()["error"]["details"][0]["field"] == "owner_id"


async def test_user_action_limit_is_scoped_per_user() -> None:
    """Two different owner_ids must not share one bucket - otherwise one busy user would 429 a
    second, unrelated one."""
    fake_project_id = uuid.uuid4()

    async def _transcribe(owner_id: uuid.UUID) -> int:
        async with httpx.AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            cookies={"amee_session": sign_user_id(owner_id)},
        ) as client:
            response = await client.post(
                f"/api/v1/projects/{fake_project_id}/transcribe"
            )
            return response.status_code

    first_user_status = await _transcribe(await _make_owner())
    second_user_status = await _transcribe(await _make_owner())

    assert first_user_status != 429
    assert second_user_status != 429


async def test_blanket_ip_limit_excludes_job_polling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """GET /jobs/{id} is deliberately left off the blanket limiter (router.py) - it's polled
    roughly every 2s while a job runs, which alone would exhaust a tiny per-minute budget."""
    monkeypatch.setattr("app.api.v1.deps._IP_REQUEST_LIMIT", 1)
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        first = await client.get("/api/v1/presets")
        assert first.status_code == 200

        exhausted = await client.get("/api/v1/presets")
        assert exhausted.status_code == 429

        # Same client, same exhausted IP budget - still not limited on this route.
        job_poll = await client.get(f"/api/v1/jobs/{uuid.uuid4()}")

    assert job_poll.status_code == 404
