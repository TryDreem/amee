import uuid

from app.db import async_session_factory
from app.repositories import preset as preset_repo


async def test_list_all_returns_seeded_default_preset() -> None:
    async with async_session_factory() as session:
        presets = await preset_repo.list_all(session)

    assert len(presets) >= 1
    default_presets = [p for p in presets if p.default]
    assert len(default_presets) == 1
    assert default_presets[0].id == uuid.UUID("c1a1a1a1-0000-4000-8000-000000000001")
    assert default_presets[0].name == "Bold Statement"
    assert default_presets[0].base["fontFamily"] == "Inter"
    assert default_presets[0].bounds["fontSize"] == {"min": 0.04, "max": 0.12}
