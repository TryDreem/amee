import httpx
from httpx import ASGITransport

from app.db import async_session_factory
from app.integrations.session_cookie import sign_user_id
from app.integrations.whisperx import TranscribedWord
from app.main import app
from app.repositories import project as project_repo
from app.repositories import raw_transcript as raw_transcript_repo
from app.repositories import user as user_repo
from app.services import ecs as ecs_service


async def test_reset_to_raw_not_found_before_transcription() -> None:
    async with async_session_factory() as session:
        owner = await user_repo.create_guest(session)
        project = await project_repo.create(
            session,
            owner_id=owner.id,
            name="Reset to raw not-transcribed test",
            video_url="/files/projects/z/source.mp4",
        )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        cookies={"amee_session": sign_user_id(owner.id)},
    ) as client:
        response = await client.post(f"/api/v1/projects/{project.id}/reset-to-raw")

    assert response.status_code == 404


async def test_reset_to_raw_owned_by_someone_else_is_not_found() -> None:
    """The IDOR/BOLA fix (require_project_owner) - a real project id that isn't the caller's own
    must read exactly like a nonexistent one."""
    async with async_session_factory() as session:
        owner = await user_repo.create_guest(session)
        project = await project_repo.create(
            session,
            owner_id=owner.id,
            name="Someone else's project",
            video_url="/files/projects/z/source.mp4",
        )
        await raw_transcript_repo.create(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            words=[{"text": "hi", "start": 0.0, "end": 0.3}],
        )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(f"/api/v1/projects/{project.id}/reset-to-raw")

    assert response.status_code == 404


async def test_reset_to_raw_regenerates_from_raw_transcript() -> None:
    async with async_session_factory() as session:
        owner = await user_repo.create_guest(session)
        project = await project_repo.create(
            session,
            owner_id=owner.id,
            name="Reset to raw test",
            video_url="/files/projects/z/source.mp4",
        )
        await raw_transcript_repo.create(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            words=[
                {"text": "hello", "start": 0.0, "end": 0.4},
                {"text": "world", "start": 0.4, "end": 0.9},
            ],
        )
        # ECS has since been heavily edited away from the raw words.
        await ecs_service.create_initial_ecs(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            words=[TranscribedWord(text="edited", start=0.0, end=0.3)],
        )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        cookies={"amee_session": sign_user_id(owner.id)},
    ) as client:
        response = await client.post(f"/api/v1/projects/{project.id}/reset-to-raw")

    assert response.status_code == 200
    body = response.json()
    assert body["project_id"] == str(project.id)
    flattened = [w for seg in body["segments"] for w in seg["words"]]
    assert [w["text"] for w in flattened] == ["hello", "world"]

    # Fresh ids, not reused from anywhere (D2 - raw-transcript words carry no id).
    word_ids = [w["id"] for w in flattened]
    assert len(set(word_ids)) == len(word_ids)

    # E8: the splitter never sees style, so a fresh reset always wipes any
    # previously-set segment.overrides - result is always null.
    assert all(seg["overrides"] is None for seg in body["segments"])


async def test_reset_to_raw_does_not_persist() -> None:
    async with async_session_factory() as session:
        owner = await user_repo.create_guest(session)
        project = await project_repo.create(
            session,
            owner_id=owner.id,
            name="Reset to raw no-persist test",
            video_url="/files/projects/z/source.mp4",
        )
        await raw_transcript_repo.create(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            words=[{"text": "raw", "start": 0.0, "end": 0.3}],
        )
        original_ecs = await ecs_service.create_initial_ecs(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            words=[TranscribedWord(text="edited", start=0.0, end=0.3)],
        )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        cookies={"amee_session": sign_user_id(owner.id)},
    ) as client:
        response = await client.post(f"/api/v1/projects/{project.id}/reset-to-raw")
    assert response.status_code == 200

    async with async_session_factory() as session:
        unchanged = await ecs_service.get_ecs(session, project.id)
    assert unchanged == original_ecs
