import uuid

import httpx
from httpx import ASGITransport

from app.db import async_session_factory
from app.integrations.whisperx import TranscribedWord
from app.main import app
from app.repositories import project as project_repo
from app.services import ecs as ecs_service


async def test_recalculate_groups_returns_200_with_segments() -> None:
    words = [
        {"id": str(uuid.uuid4()), "text": "hello", "start": 0.0, "end": 0.4},
        {"id": str(uuid.uuid4()), "text": "world", "start": 0.4, "end": 0.9},
    ]

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            f"/api/v1/projects/{uuid.uuid4()}/recalculate-groups",
            json={"words": words},
        )

    assert response.status_code == 200
    body = response.json()
    assert "segments" in body
    flattened = [w for seg in body["segments"] for w in seg["words"]]
    assert [w["text"] for w in flattened] == ["hello", "world"]
    # E8: the splitter never sees style, so it can never produce or
    # preserve segment.overrides - result is always null.
    assert all(seg["overrides"] is None for seg in body["segments"])


async def test_recalculate_groups_does_not_persist_or_require_a_real_project() -> None:
    # Stateless (E6, contract §10) - no DB touch at all, so even a
    # nonexistent project_id in the URL works.
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="Recalculate groups endpoint test",
            video_url="/files/projects/z/source.mp4",
        )
        original_ecs = await ecs_service.create_initial_ecs(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            words=[TranscribedWord(text="original", start=0.0, end=0.3)],
        )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            f"/api/v1/projects/{project.id}/recalculate-groups",
            json={
                "words": [
                    {
                        "id": str(uuid.uuid4()),
                        "text": "unsaved-edit",
                        "start": 0.0,
                        "end": 0.3,
                    }
                ]
            },
        )
    assert response.status_code == 200

    async with async_session_factory() as session:
        unchanged = await ecs_service.get_ecs(session, project.id)
    assert unchanged == original_ecs
