import uuid
from pathlib import Path

import httpx
from httpx import ASGITransport

from app.main import app

_DEFAULT_PRESET_ID = "c1a1a1a1-0000-4000-8000-000000000001"


async def _create_project(sample_video: Path) -> str:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        with sample_video.open("rb") as f:
            response = await client.post(
                "/api/v1/projects",
                files={"file": ("sample.mp4", f, "video/mp4")},
            )
    project_id: str = response.json()["id"]
    return project_id


async def test_get_style_returns_default_preset_immediately(
    sample_video: Path,
) -> None:
    project_id = await _create_project(sample_video)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/v1/projects/{project_id}/style")

    assert response.status_code == 200
    body = response.json()
    assert body["presetId"] == _DEFAULT_PRESET_ID
    assert body["overrides"] == {}


async def test_get_style_not_found_for_missing_project() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/v1/projects/{uuid.uuid4()}/style")

    assert response.status_code == 404


async def test_put_style_roundtrip(sample_video: Path) -> None:
    project_id = await _create_project(sample_video)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.put(
            f"/api/v1/projects/{project_id}/style",
            json={
                "presetId": _DEFAULT_PRESET_ID,
                "overrides": {"fontSize": 0.1, "color": "#ff0000"},
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["overrides"]["fontSize"] == 0.1
    assert body["overrides"]["color"] == "#ff0000"


async def test_put_style_out_of_bounds_returns_422_with_details(
    sample_video: Path,
) -> None:
    project_id = await _create_project(sample_video)

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.put(
            f"/api/v1/projects/{project_id}/style",
            json={
                "presetId": _DEFAULT_PRESET_ID,
                "overrides": {"verticalPosition": 1.5},
            },
        )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation_error"
    assert body["error"]["details"][0]["field"] == "overrides.verticalPosition"


async def test_put_style_not_found_for_missing_project() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.put(
            f"/api/v1/projects/{uuid.uuid4()}/style",
            json={"presetId": _DEFAULT_PRESET_ID, "overrides": {}},
        )

    assert response.status_code == 404
