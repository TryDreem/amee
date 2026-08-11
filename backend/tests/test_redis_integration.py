import os
from unittest.mock import patch

import pytest

from app.integrations import redis as redis_integration


async def test_set_then_get_roundtrips() -> None:
    await redis_integration.set_export_progress("job-a", 42.5)

    assert await redis_integration.get_export_progress("job-a") == 42.5


async def test_get_is_none_when_never_set() -> None:
    assert await redis_integration.get_export_progress("job-never-set") is None


async def test_clear_removes_the_value() -> None:
    await redis_integration.set_export_progress("job-b", 10.0)
    await redis_integration.clear_export_progress("job-b")

    assert await redis_integration.get_export_progress("job-b") is None


async def test_keys_are_scoped_per_job_id() -> None:
    await redis_integration.set_export_progress("job-c", 1.0)
    await redis_integration.set_export_progress("job-d", 2.0)

    assert await redis_integration.get_export_progress("job-c") == 1.0
    assert await redis_integration.get_export_progress("job-d") == 2.0


@pytest.mark.parametrize(
    "env",
    [
        pytest.param({}, id="unset"),
        pytest.param({"AMEE_REDIS_URL": "redis://localhost:1/0"}, id="unreachable"),
    ],
)
async def test_degrades_silently_when_redis_is_unavailable(
    env: dict[str, str],
) -> None:
    """A3/A5: whether Redis was never configured or is simply unreachable,
    every call here must degrade to "no value" - never raise - since none of
    this is a source of truth the app can't function without."""
    with patch.dict(os.environ, env, clear=True):
        await redis_integration.set_export_progress("job-e", 5.0)  # must not raise
        assert await redis_integration.get_export_progress("job-e") is None
        await redis_integration.clear_export_progress("job-e")  # must not raise
