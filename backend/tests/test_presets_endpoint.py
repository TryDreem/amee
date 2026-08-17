import httpx
from httpx import ASGITransport

from app.main import app


async def test_get_presets_returns_exactly_one_default() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/v1/presets")

    assert response.status_code == 200
    body = response.json()
    assert len(body) >= 1

    defaults = [p for p in body if p["default"] is True]
    assert len(defaults) == 1

    preset = defaults[0]
    assert preset["name"] == "Bold Statement"
    assert preset["base"]["fontSize"] == 0.04
    assert preset["base"]["revealMode"] == "progressive"
    assert preset["base"]["highlightColors"] == ["#ffe600"]
    assert preset["base"]["textTransform"] == "none"
    assert preset["base"]["italic"] is False
    assert preset["base"]["glow"] is False
    assert preset["base"]["outline"] is None
    assert preset["base"]["shadow"] is None
    assert preset["bounds"]["verticalPosition"] == {"min": 0.1, "max": 0.85}
    # outline/shadow/glow/textTransform have no per-preset bounds entry (arch §10).
    assert "outline" not in preset["bounds"]
    assert "shadow" not in preset["bounds"]
