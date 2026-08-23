"""app/services/projects.py::seed_demo_project - the pre-baked sample project every brand-new
user (guest mint or fresh Google account) gets immediately, cloned from a human-prepared template
project without running WhisperX/ffmpeg again. Hooked from app/api/v1/deps.py (guest mint) and
app/services/auth.py (fresh Google signup) - both exercised here via the real HTTP/service paths,
not by calling seed_demo_project directly, so a regression in either hook site would show up too.
"""

import uuid
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport

from app.db import async_session_factory
from app.integrations import storage
from app.integrations.ffmpeg import probe_video
from app.integrations.google_oauth import GoogleProfile
from app.integrations.whisperx import TranscribedWord
from app.main import app
from app.repositories import project as project_repo
from app.repositories import user as user_repo
from app.services import auth as auth_service
from app.services import ecs as ecs_service
from app.services import projects as projects_service
from app.services import style as style_service


async def _create_template_project(video_path: Path) -> uuid.UUID:
    """A fully transcribed + styled project, standing in for the human-prepared demo template a
    real deployment points AMEE_DEMO_PROJECT_ID at."""
    async with async_session_factory() as session:
        owner = await user_repo.create_guest(session)
        project_id = uuid.uuid4()
        _, video_url = await storage.save_video(
            project_id, "sample.mp4", video_path.read_bytes()
        )
        await project_repo.create(
            session,
            project_id=project_id,
            owner_id=owner.id,
            name="Template",
            video_url=video_url,
        )
        probe = await probe_video(video_path)
        await project_repo.update_media(
            session,
            project_id,
            width=probe.width,
            height=probe.height,
            duration_seconds=probe.duration_seconds,
            thumbnail_url=f"/files/projects/{project_id}/thumbnail.jpg",
        )
        await project_repo.update_preview(
            session, project_id, preview_video_url=video_url
        )
        await style_service.create_default_style(
            session, project_id=project_id, owner_id=owner.id
        )
        await ecs_service.create_initial_ecs(
            session,
            project_id=project_id,
            owner_id=owner.id,
            words=[TranscribedWord(text="hi", start=0.0, end=0.3)],
        )
        return project_id


async def test_no_op_when_demo_project_id_is_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("AMEE_DEMO_PROJECT_ID", raising=False)
    async with async_session_factory() as session:
        owner = await user_repo.create_guest(session)
        await projects_service.seed_demo_project(session, owner.id)

    async with async_session_factory() as session:
        page, total = await project_repo.list_page(
            session, owner_id=owner.id, limit=10, offset=0
        )
    assert total == 0


async def test_no_op_when_demo_project_id_is_malformed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AMEE_DEMO_PROJECT_ID", "not-a-uuid")
    async with async_session_factory() as session:
        owner = await user_repo.create_guest(session)
        await projects_service.seed_demo_project(session, owner.id)

    async with async_session_factory() as session:
        _, total = await project_repo.list_page(
            session, owner_id=owner.id, limit=10, offset=0
        )
    assert total == 0


async def test_no_op_when_demo_project_id_points_at_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AMEE_DEMO_PROJECT_ID", str(uuid.uuid4()))
    async with async_session_factory() as session:
        owner = await user_repo.create_guest(session)
        await projects_service.seed_demo_project(session, owner.id)

    async with async_session_factory() as session:
        _, total = await project_repo.list_page(
            session, owner_id=owner.id, limit=10, offset=0
        )
    assert total == 0


async def test_seeds_an_independent_clone_with_the_same_ecs_and_style(
    monkeypatch: pytest.MonkeyPatch, sample_video: Path
) -> None:
    template_id = await _create_template_project(sample_video)
    monkeypatch.setenv("AMEE_DEMO_PROJECT_ID", str(template_id))

    async with async_session_factory() as session:
        owner = await user_repo.create_guest(session)
        await projects_service.seed_demo_project(session, owner.id)

    async with async_session_factory() as session:
        items, total = await project_repo.list_page(
            session, owner_id=owner.id, limit=10, offset=0
        )
    assert total == 1
    clone = items[0]
    assert clone.id != template_id
    assert clone.owner_id == owner.id
    assert clone.video_url == f"/files/projects/{template_id}/source.mp4"
    assert clone.thumbnail_url == f"/files/projects/{template_id}/thumbnail.jpg"

    async with async_session_factory() as session:
        template_ecs = await ecs_service.get_ecs(session, template_id)
        clone_ecs = await ecs_service.get_ecs(session, clone.id)
        template_style = await style_service.get_style(session, template_id)
        clone_style = await style_service.get_style(session, clone.id)

    assert template_ecs is not None and clone_ecs is not None
    # Fresh Segment/Word ids, NOT the template's own: segments.id/ecs_words.id are plain
    # (non-composite) primary keys in the real schema, so reusing the template's still-existing
    # ids here would collide with its own rows - INVARIANTS.md V9 only requires uniqueness
    # *within* a document, which doesn't by itself make cross-document reuse safe against a
    # global PK. Structure (word order/text/timing) carries over unchanged.
    template_segment_ids = {s.id for s in template_ecs.segments}
    clone_segment_ids = {s.id for s in clone_ecs.segments}
    assert clone_segment_ids.isdisjoint(template_segment_ids)
    assert [w.text for s in clone_ecs.segments for w in s.words] == [
        w.text for s in template_ecs.segments for w in s.words
    ]
    assert [w.start for s in clone_ecs.segments for w in s.words] == [
        w.start for s in template_ecs.segments for w in s.words
    ]
    assert template_style is not None and clone_style is not None
    assert clone_style.presetId == template_style.presetId


async def test_demo_clone_does_not_count_against_the_project_quota(
    monkeypatch: pytest.MonkeyPatch, sample_video: Path
) -> None:
    template_id = await _create_template_project(sample_video)
    monkeypatch.setenv("AMEE_DEMO_PROJECT_ID", str(template_id))

    async with async_session_factory() as session:
        owner = await user_repo.create_guest(session)
        await projects_service.seed_demo_project(session, owner.id)
        refreshed = await user_repo.get(session, owner.id)

    assert refreshed is not None
    assert refreshed.projects_uploaded_count == 0


async def test_deleting_the_demo_clone_leaves_the_template_file_untouched(
    monkeypatch: pytest.MonkeyPatch, sample_video: Path
) -> None:
    template_id = await _create_template_project(sample_video)
    monkeypatch.setenv("AMEE_DEMO_PROJECT_ID", str(template_id))

    async with async_session_factory() as session:
        owner = await user_repo.create_guest(session)
        await projects_service.seed_demo_project(session, owner.id)
        items, _ = await project_repo.list_page(
            session, owner_id=owner.id, limit=10, offset=0
        )
    clone = items[0]
    template_video_path = await storage.resolve_url(clone.video_url)
    assert template_video_path.exists()

    async with async_session_factory() as session:
        deleted = await projects_service.delete_project(session, clone.id)
    assert deleted is True

    # The clone's own video_url points at the template's project_id, not its own - deleting the
    # clone only rmtrees projects/{clone.id}/, so the shared template file must survive.
    assert template_video_path.exists()
    async with async_session_factory() as session:
        template_still_there = await project_repo.get(session, template_id)
    assert template_still_there is not None


async def test_guest_mint_over_http_seeds_the_demo_project_exactly_once(
    monkeypatch: pytest.MonkeyPatch, sample_video: Path
) -> None:
    template_id = await _create_template_project(sample_video)
    monkeypatch.setenv("AMEE_DEMO_PROJECT_ID", str(template_id))

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        first = await client.get("/api/v1/auth/me")
        await client.get("/api/v1/auth/me")
        await client.get("/api/v1/projects")

    owner_id = uuid.UUID(first.json()["id"])
    async with async_session_factory() as session:
        _, total = await project_repo.list_page(
            session, owner_id=owner_id, limit=10, offset=0
        )
    assert total == 1


async def test_fresh_google_signup_seeds_the_demo_project(
    monkeypatch: pytest.MonkeyPatch, sample_video: Path
) -> None:
    template_id = await _create_template_project(sample_video)
    monkeypatch.setenv("AMEE_DEMO_PROJECT_ID", str(template_id))

    profile = GoogleProfile(
        sub="google-sub-demo-1",
        email="fresh@example.com",
        name="Fresh",
        picture=None,
    )
    async with async_session_factory() as session:
        # Not a guest promotion (no current guest session) - this is the "someone already signed
        # in as one real account signs in as a brand-new different one" branch of
        # sign_in_with_google, the other place a genuinely new User row is minted.
        other = await user_repo.create_google_user(
            session,
            google_sub="google-sub-demo-other",
            email="other@example.com",
            name="Other",
            avatar_url=None,
        )
        resolved = await auth_service.sign_in_with_google(
            session, current_user_id=other.id, profile=profile
        )

    assert resolved != other.id
    async with async_session_factory() as session:
        _, total = await project_repo.list_page(
            session, owner_id=resolved, limit=10, offset=0
        )
    assert total == 1


async def test_promoting_a_guest_or_repeat_login_does_not_get_a_second_demo_project(
    monkeypatch: pytest.MonkeyPatch, sample_video: Path
) -> None:
    """The guest mint (over HTTP, so app/api/v1/deps.py's real hook fires) seeds one demo project.
    Promoting that same guest to a Google account keeps the same User row (sign_in_with_google's
    promote_guest_to_google branch, not create_google_user) - not a new user, so no second seed.
    Neither does signing in again afterward, which resolves to the now-existing google_sub."""
    template_id = await _create_template_project(sample_video)
    monkeypatch.setenv("AMEE_DEMO_PROJECT_ID", str(template_id))

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        me = await client.get("/api/v1/auth/me")
    guest_id = uuid.UUID(me.json()["id"])

    profile = GoogleProfile(
        sub="google-sub-demo-2", email="repeat@example.com", name="Repeat", picture=None
    )
    async with async_session_factory() as session:
        first_login = await auth_service.sign_in_with_google(
            session, current_user_id=guest_id, profile=profile
        )
    async with async_session_factory() as session:
        second_login = await auth_service.sign_in_with_google(
            session, current_user_id=first_login, profile=profile
        )

    assert first_login == guest_id
    assert second_login == guest_id
    async with async_session_factory() as session:
        _, total = await project_repo.list_page(
            session, owner_id=first_login, limit=10, offset=0
        )
    assert total == 1
