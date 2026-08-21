"""app/services/auth.py::sign_in_with_google — the four-case branch that decides whether a
guest's work follows them onto a Google account, gets left behind, or is never touched.

Google itself is not involved here: these take a GoogleProfile directly, since the HTTP side has
its own tests (tests/test_google_oauth.py).
"""

import uuid
from pathlib import Path

from app.db import async_session_factory
from app.integrations import storage
from app.integrations.google_oauth import GoogleProfile
from app.repositories import project as project_repo
from app.repositories import user as user_repo
from app.services import auth as auth_service
from app.services import style as style_service

_PROFILE = GoogleProfile(
    sub="google-sub-1",
    email="alice@example.com",
    name="Alice",
    picture="https://img/a.png",
)


async def _seed_project(owner_id: uuid.UUID, sample_video: Path) -> uuid.UUID:
    """A project plus its style row, so the multi-table reassignment has something to move in
    more than one table."""
    project_id = uuid.uuid4()
    _, video_url = await storage.save_video(
        project_id, "sample.mp4", sample_video.read_bytes()
    )
    async with async_session_factory() as session:
        await project_repo.create(
            session,
            project_id=project_id,
            owner_id=owner_id,
            name="Guest work",
            video_url=video_url,
        )
        await style_service.create_default_style(
            session, project_id=project_id, owner_id=owner_id
        )
    return project_id


async def test_guest_with_no_matching_google_account_is_promoted_in_place(
    sample_video: Path,
) -> None:
    """The common sign-up path. The user id must NOT change — that's what makes this safe with
    no reassignment at all."""
    async with async_session_factory() as session:
        guest = await user_repo.create_guest(session)
    project_id = await _seed_project(guest.id, sample_video)

    async with async_session_factory() as session:
        resolved = await auth_service.sign_in_with_google(
            session, current_user_id=guest.id, profile=_PROFILE
        )

    assert resolved == guest.id
    async with async_session_factory() as session:
        user = await user_repo.get(session, guest.id)
        assert user is not None
        assert user.is_guest is False
        assert user.google_sub == "google-sub-1"
        assert user.email == "alice@example.com"
        # Same id, so ownership never had to move.
        project = await project_repo.get(session, project_id)
        assert project is not None
        assert project.owner_id == guest.id


async def test_returning_user_signing_in_again_changes_nothing(
    sample_video: Path,
) -> None:
    async with async_session_factory() as session:
        guest = await user_repo.create_guest(session)
        await auth_service.sign_in_with_google(
            session, current_user_id=guest.id, profile=_PROFILE
        )

    async with async_session_factory() as session:
        resolved = await auth_service.sign_in_with_google(
            session, current_user_id=guest.id, profile=_PROFILE
        )

    assert resolved == guest.id
    async with async_session_factory() as session:
        user = await user_repo.get(session, guest.id)
        assert user is not None
        assert user.last_seen_at is not None


async def test_guest_signing_into_an_existing_account_brings_their_work_along(
    sample_video: Path,
) -> None:
    """The reassignment path: this Google account already has its own row from a previous
    session (say, a different browser), and the guest has since made a project here."""
    async with async_session_factory() as session:
        established = await user_repo.create_google_user(
            session,
            google_sub="google-sub-2",
            email="bob@example.com",
            name="Bob",
            avatar_url=None,
        )
        guest = await user_repo.create_guest(session)
    project_id = await _seed_project(guest.id, sample_video)

    profile = GoogleProfile(
        sub="google-sub-2", email="bob@example.com", name="Bob", picture=None
    )
    async with async_session_factory() as session:
        resolved = await auth_service.sign_in_with_google(
            session, current_user_id=guest.id, profile=profile
        )

    assert resolved == established.id
    async with async_session_factory() as session:
        project = await project_repo.get(session, project_id)
        assert project is not None
        assert project.owner_id == established.id


async def test_reassignment_moves_the_style_row_too(sample_video: Path) -> None:
    """Five tables carry owner_id. A project that moved while its style/segments/transcript/jobs
    stayed behind is a worse state than not moving at all — this guards the one that's easiest
    to seed alongside a project."""
    from app.repositories import style as style_repo

    async with async_session_factory() as session:
        established = await user_repo.create_google_user(
            session,
            google_sub="google-sub-3",
            email="carol@example.com",
            name="Carol",
            avatar_url=None,
        )
        guest = await user_repo.create_guest(session)
    project_id = await _seed_project(guest.id, sample_video)

    profile = GoogleProfile(
        sub="google-sub-3", email="carol@example.com", name="Carol", picture=None
    )
    async with async_session_factory() as session:
        await auth_service.sign_in_with_google(
            session, current_user_id=guest.id, profile=profile
        )

    async with async_session_factory() as session:
        style = await style_repo.get(session, project_id)
        assert style is not None
        assert style.owner_id == established.id


async def test_a_signed_in_user_switching_accounts_keeps_their_projects_put(
    sample_video: Path,
) -> None:
    """Not a guest — a real account signing in as a *different* real account. Their first
    account's work must not be absorbed into the second."""
    async with async_session_factory() as session:
        first = await user_repo.create_google_user(
            session,
            google_sub="google-sub-4",
            email="dave@example.com",
            name="Dave",
            avatar_url=None,
        )
        second = await user_repo.create_google_user(
            session,
            google_sub="google-sub-5",
            email="erin@example.com",
            name="Erin",
            avatar_url=None,
        )
    project_id = await _seed_project(first.id, sample_video)

    profile = GoogleProfile(
        sub="google-sub-5", email="erin@example.com", name="Erin", picture=None
    )
    async with async_session_factory() as session:
        resolved = await auth_service.sign_in_with_google(
            session, current_user_id=first.id, profile=profile
        )

    assert resolved == second.id
    async with async_session_factory() as session:
        project = await project_repo.get(session, project_id)
        assert project is not None
        assert project.owner_id == first.id
