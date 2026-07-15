import uuid

from app.db import async_session_factory
from app.repositories import project as project_repo
from app.repositories import style as style_repo
from app.services import style as style_service


async def test_create_default_style_uses_the_default_preset() -> None:
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

    async with async_session_factory() as session:
        style = await style_repo.get(session, project.id)

    assert style is not None
    assert style.preset_id == uuid.UUID("c1a1a1a1-0000-4000-8000-000000000001")
    assert style.overrides == {}
