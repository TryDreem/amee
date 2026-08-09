import uuid

from app.db import async_session_factory
from app.repositories import project as project_repo


async def test_create_and_get_roundtrip() -> None:
    owner_id = uuid.uuid4()
    async with async_session_factory() as session:
        created = await project_repo.create(
            session,
            owner_id=owner_id,
            name="Test project",
            video_url="/files/projects/x/source.mp4",
        )

        fetched = await project_repo.get(session, created.id)

        assert fetched is not None
        assert fetched.id == created.id
        assert fetched.owner_id == owner_id
        assert fetched.name == "Test project"
        # Null until the transcribe job's probe/thumbnail/proxy branches
        # finish (arch §2.8) — not at upload time.
        assert fetched.video_width is None
        assert fetched.video_height is None
        assert fetched.video_duration_seconds is None
        assert fetched.thumbnail_url is None
        assert fetched.preview_video_url is None
        assert fetched.created_at is not None


async def test_get_missing_returns_none() -> None:
    async with async_session_factory() as session:
        assert await project_repo.get(session, uuid.uuid4()) is None


async def test_list_page_includes_created() -> None:
    async with async_session_factory() as session:
        created = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="List test",
            video_url="/files/projects/y/source.mp4",
        )

        page, total = await project_repo.list_page(session, limit=50, offset=0)

        assert any(p.id == created.id for p in page)
        assert total >= 1


async def test_update_media_and_update_preview_roundtrip() -> None:
    async with async_session_factory() as session:
        created = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="Update test",
            video_url="/files/projects/w/source.mp4",
        )

        await project_repo.update_media(
            session,
            created.id,
            width=1920,
            height=1080,
            duration_seconds=12.5,
            thumbnail_url="/files/projects/w/thumbnail.jpg",
        )
        await project_repo.update_preview(
            session, created.id, preview_video_url="/files/projects/w/source.mp4"
        )

        fetched = await project_repo.get(session, created.id)
        assert fetched is not None
        assert fetched.video_width == 1920
        assert fetched.video_height == 1080
        assert fetched.video_duration_seconds == 12.5
        assert fetched.thumbnail_url == "/files/projects/w/thumbnail.jpg"
        assert fetched.preview_video_url == "/files/projects/w/source.mp4"


async def test_new_project_timestamps_start_at_creation_time() -> None:
    async with async_session_factory() as session:
        created = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="Timestamps project",
            video_url="/files/projects/t/source.mp4",
        )

        fetched = await project_repo.get(session, created.id)

        assert fetched is not None
        # A never-edited project reads as "last updated at upload time",
        # matching how the migration backfills pre-existing rows.
        assert fetched.updated_at == fetched.created_at
        # D13: null means "never opened", written only by POST .../open.
        assert fetched.last_opened_at is None


async def test_background_media_writes_do_not_bump_updated_at() -> None:
    """D12: `updated_at` tracks caption/style edits only. The transcribe job
    writes this same row twice (update_media, update_preview) - if the
    column ever gained `onupdate=func.now()`, those background writes would
    silently redefine it as "last touched by anything", and sort=updated
    would rank every freshly-transcribed project as recently edited."""
    async with async_session_factory() as session:
        created = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="Background writes project",
            video_url="/files/projects/b/source.mp4",
        )
        original_updated_at = created.updated_at

        await project_repo.update_media(
            session,
            created.id,
            width=1920,
            height=1080,
            duration_seconds=3.0,
            thumbnail_url="/files/projects/b/thumbnail.jpg",
        )
        await project_repo.update_preview(
            session, created.id, preview_video_url="/files/projects/b/source.mp4"
        )

        fetched = await project_repo.get(session, created.id)
        assert fetched is not None
        assert fetched.updated_at == original_updated_at
