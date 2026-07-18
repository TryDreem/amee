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


async def test_put_style_with_new_override_fields_roundtrip(
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
                "perPhraseStyle": True,
                "overrides": {
                    "highlightColors": ["#ff0000", "#00ff00"],
                    "textTransform": "uppercase",
                    "italic": True,
                    "glow": True,
                    "outline": {"size": "small", "color": "#000000", "alpha": 50},
                    "shadow": {"size": "large", "color": "#111111", "alpha": 80},
                },
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["perPhraseStyle"] is True
    assert body["overrides"]["highlightColors"] == ["#ff0000", "#00ff00"]
    assert body["overrides"]["textTransform"] == "uppercase"
    assert body["overrides"]["italic"] is True
    assert body["overrides"]["glow"] is True
    assert body["overrides"]["outline"] == {
        "size": "small",
        "color": "#000000",
        "alpha": 50,
    }
    assert body["overrides"]["shadow"] == {
        "size": "large",
        "color": "#111111",
        "alpha": 80,
    }

    # Persisted, not just echoed.
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        get_response = await client.get(f"/api/v1/projects/{project_id}/style")
    assert get_response.json() == body


async def test_put_style_outline_alpha_out_of_fixed_range_returns_422(
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
                "overrides": {
                    "outline": {"size": "small", "color": "#000000", "alpha": 150}
                },
            },
        )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["details"][0]["field"] == "overrides.outline.alpha"
