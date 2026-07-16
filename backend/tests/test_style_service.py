import uuid

import pytest

from app.db import async_session_factory
from app.exceptions import DomainValidationError
from app.repositories import project as project_repo
from app.repositories import style as style_repo
from app.schemas.style import CaptionStyleSpecPutBody, SafeArea, StyleOverrides
from app.services import style as style_service

_DEFAULT_PRESET_ID = uuid.UUID("c1a1a1a1-0000-4000-8000-000000000001")


async def _make_project() -> uuid.UUID:
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="Style service test",
            video_url="/files/projects/z/source.mp4",
        )
        await style_service.create_default_style(
            session, project_id=project.id, owner_id=project.owner_id
        )
        return project.id


async def test_create_default_style_uses_the_default_preset() -> None:
    project_id = await _make_project()

    async with async_session_factory() as session:
        style = await style_repo.get(session, project_id)

    assert style is not None
    assert style.preset_id == _DEFAULT_PRESET_ID
    assert style.overrides == {}


async def test_put_style_within_bounds_persists() -> None:
    project_id = await _make_project()
    body = CaptionStyleSpecPutBody(
        presetId=_DEFAULT_PRESET_ID,
        overrides=StyleOverrides(fontSize=0.1, verticalPosition=0.5),
    )

    async with async_session_factory() as session:
        result = await style_service.put_style(session, project_id, body)

    assert result is not None
    assert result.overrides.fontSize == 0.1
    assert result.overrides.verticalPosition == 0.5


async def test_put_style_out_of_bounds_font_size_raises() -> None:
    project_id = await _make_project()
    body = CaptionStyleSpecPutBody(
        presetId=_DEFAULT_PRESET_ID,
        # preset bounds: fontSize 0.04-0.12 (M2 step 1 seed)
        overrides=StyleOverrides(fontSize=0.5),
    )

    async with async_session_factory() as session:
        with pytest.raises(DomainValidationError) as exc_info:
            await style_service.put_style(session, project_id, body)

    assert exc_info.value.details[0].field == "overrides.fontSize"


async def test_put_style_out_of_bounds_safe_area_raises() -> None:
    project_id = await _make_project()
    body = CaptionStyleSpecPutBody(
        presetId=_DEFAULT_PRESET_ID,
        # preset bounds: safeArea.top 0.05-0.2 (M2 step 1 seed)
        overrides=StyleOverrides(safeArea=SafeArea(top=0.9, bottom=0.1)),
    )

    async with async_session_factory() as session:
        with pytest.raises(DomainValidationError) as exc_info:
            await style_service.put_style(session, project_id, body)

    fields = {d.field for d in exc_info.value.details}
    assert "overrides.safeArea.top" in fields


async def test_put_style_unknown_preset_raises() -> None:
    project_id = await _make_project()
    body = CaptionStyleSpecPutBody(presetId=uuid.uuid4(), overrides=StyleOverrides())

    async with async_session_factory() as session:
        with pytest.raises(DomainValidationError) as exc_info:
            await style_service.put_style(session, project_id, body)

    assert exc_info.value.details[0].field == "presetId"


async def test_put_style_missing_project_returns_none() -> None:
    body = CaptionStyleSpecPutBody(
        presetId=_DEFAULT_PRESET_ID, overrides=StyleOverrides()
    )
    async with async_session_factory() as session:
        result = await style_service.put_style(session, uuid.uuid4(), body)
    assert result is None
