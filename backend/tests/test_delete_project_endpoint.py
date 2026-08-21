import uuid
from pathlib import Path

import httpx
from httpx import ASGITransport

from app.db import async_session_factory
from app.integrations import redis as redis_integration
from app.integrations import storage
from app.integrations.ffmpeg import probe_video
from app.integrations.session_cookie import sign_user_id
from app.integrations.whisperx import TranscribedWord
from app.main import app
from app.repositories import ecs as ecs_repo
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.repositories import raw_transcript as raw_transcript_repo
from app.repositories import style as style_repo
from app.repositories import user as user_repo
from app.schemas.job import JobStatus, JobType
from app.services import ecs as ecs_service
from app.services import style as style_service


async def _make_owner() -> uuid.UUID:
    async with async_session_factory() as session:
        user = await user_repo.create_guest(session)
    return user.id


def _cookies(owner_id: uuid.UUID) -> dict[str, str]:
    return {"amee_session": sign_user_id(owner_id)}


async def _create_bare_project() -> tuple[uuid.UUID, dict[str, str]]:
    owner_id = await _make_owner()
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=owner_id,
            name="Delete endpoint test",
            video_url="/files/projects/z/source.mp4",
        )
        return project.id, _cookies(owner_id)


async def _create_fully_transcribed_project(
    sample_video: Path,
) -> tuple[uuid.UUID, dict[str, str]]:
    """Seeds every child table this endpoint has to cascade through: a real
    file on disk, a raw transcript, ecs (segments+words), and a style -
    the same shape a real transcribed project has in production."""
    owner_id = await _make_owner()
    async with async_session_factory() as session:
        project_id = uuid.uuid4()
        _, video_url = await storage.save_video(
            project_id, "sample.mp4", sample_video.read_bytes()
        )
        project = await project_repo.create(
            session,
            project_id=project_id,
            owner_id=owner_id,
            name="Full cascade test",
            video_url=video_url,
        )
        probe = await probe_video(sample_video)
        await project_repo.update_media(
            session,
            project.id,
            width=probe.width,
            height=probe.height,
            duration_seconds=probe.duration_seconds,
            thumbnail_url="/files/projects/z/thumbnail.jpg",
        )
        await style_service.create_default_style(
            session, project_id=project.id, owner_id=project.owner_id
        )
        await raw_transcript_repo.create(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            words=[{"text": "hi", "start": 0.0, "end": 0.3}],
        )
        await ecs_service.create_initial_ecs(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            words=[TranscribedWord(text="hi", start=0.0, end=0.3)],
        )
        transcribe_job = await job_repo.create(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            job_type=JobType.transcribe,
        )
        # Finished, not left `queued` - an active transcribe job would 409
        # this fixture's whole point (cascading through a *completed*
        # project's child rows), and that path has its own dedicated test.
        await job_repo.update_status(
            session, transcribe_job.id, status=JobStatus.done, progress=None
        )
        return project.id, _cookies(owner_id)


async def _delete(
    project_id: uuid.UUID, cookies: dict[str, str] | None = None
) -> httpx.Response:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        return await client.delete(f"/api/v1/projects/{project_id}")


async def test_delete_404s_for_missing_project() -> None:
    response = await _delete(uuid.uuid4())
    assert response.status_code == 404


async def test_delete_owned_by_someone_else_is_not_found() -> None:
    """The IDOR/BOLA fix (require_project_owner) - a real project id that isn't the caller's own
    must read exactly like a nonexistent one, and must not actually delete anything."""
    project_id, _ = await _create_bare_project()

    response = await _delete(project_id)

    assert response.status_code == 404
    async with async_session_factory() as session:
        assert await project_repo.get(session, project_id) is not None


async def test_delete_a_bare_project_succeeds() -> None:
    """A project with nothing on disk yet (never transcribed) - the file
    cleanup must be a no-op, not a crash."""
    project_id, cookies = await _create_bare_project()

    response = await _delete(project_id, cookies)

    assert response.status_code == 204
    async with async_session_factory() as session:
        assert await project_repo.get(session, project_id) is None


async def test_delete_removes_project_row_and_returns_404_afterward(
    sample_video: Path,
) -> None:
    project_id, cookies = await _create_fully_transcribed_project(sample_video)

    response = await _delete(project_id, cookies)
    assert response.status_code == 204

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        get_response = await client.get(f"/api/v1/projects/{project_id}")
    assert get_response.status_code == 404


async def test_delete_cascades_every_child_table(sample_video: Path) -> None:
    """X8: none of the foreign keys are ON DELETE CASCADE - if the service
    forgets one of the four child deletes, this raises a foreign key
    violation instead of silently leaving an orphan (already exercised by
    the fact that deletion succeeds at all in the test above), and this
    test additionally proves each row is actually gone, not just that the
    Project row itself was removed."""
    project_id, cookies = await _create_fully_transcribed_project(sample_video)

    response = await _delete(project_id, cookies)
    assert response.status_code == 204

    async with async_session_factory() as session:
        assert await ecs_repo.get_by_project(session, project_id) is None
        assert await style_repo.get(session, project_id) is None
        assert await raw_transcript_repo.get_by_project(session, project_id) is None
        assert (
            await job_repo.get_latest_by_project(
                session, project_id, JobType.transcribe
            )
            is None
        )


async def test_delete_removes_the_project_storage_directory(
    sample_video: Path,
) -> None:
    project_id, cookies = await _create_fully_transcribed_project(sample_video)
    directory = storage.project_dir(project_id)
    assert directory.exists()  # sanity check the fixture actually wrote files

    response = await _delete(project_id, cookies)

    assert response.status_code == 204
    assert not directory.exists()


async def test_delete_removes_past_export_artifacts(sample_video: Path) -> None:
    """Exports are the heaviest thing a project leaves on disk — a burned-in render is roughly
    the size of the source video, and every re-export keeps its own copy under its own job id
    (storage.video_export_paths). They are removed by `delete_project_files`'s single recursive
    delete of the project directory rather than by any export-specific cleanup, which is only
    true as long as exports keep living *inside* that directory. This test is what makes that a
    guarantee instead of a coincidence."""
    project_id, cookies = await _create_fully_transcribed_project(sample_video)
    video_dest, _ = storage.video_export_paths(project_id, uuid.uuid4())
    video_dest.write_bytes(b"burned-in render")
    srt_dest, _ = storage.srt_export_paths(project_id, uuid.uuid4())
    srt_dest.write_text("1\n00:00:00,000 --> 00:00:01,000\nhi\n")
    assert video_dest.exists() and srt_dest.exists()

    response = await _delete(project_id, cookies)

    assert response.status_code == 204
    assert not video_dest.exists()
    assert not srt_dest.exists()
    assert not (storage.project_dir(project_id) / "exports").exists()


async def test_delete_409s_when_transcribe_job_is_processing() -> None:
    """Confirmed with the human: transcribe has no OS process to signal
    (WhisperX runs in-process), so DELETE refuses outright rather than
    inventing a weaker "soft cancel" for this one case."""
    project_id, cookies = await _create_bare_project()
    async with async_session_factory() as session:
        job = await job_repo.create(
            session,
            project_id=project_id,
            owner_id=uuid.uuid4(),
            job_type=JobType.transcribe,
        )
        await job_repo.update_status(
            session, job.id, status=JobStatus.processing, progress=None
        )

    response = await _delete(project_id, cookies)

    assert response.status_code == 409
    async with async_session_factory() as session:
        assert await project_repo.get(session, project_id) is not None


async def test_delete_does_not_block_on_a_finished_transcribe_job() -> None:
    """Only queued/processing blocks (contract §4) - a project whose
    transcription already finished (or failed) must delete normally."""
    project_id, cookies = await _create_bare_project()
    async with async_session_factory() as session:
        job = await job_repo.create(
            session,
            project_id=project_id,
            owner_id=uuid.uuid4(),
            job_type=JobType.transcribe,
        )
        await job_repo.update_status(
            session, job.id, status=JobStatus.done, progress=None
        )

    response = await _delete(project_id, cookies)

    assert response.status_code == 204


async def test_delete_cancels_an_active_export_before_deleting() -> None:
    """P8/X7: an in-flight export is signalled via the real cancel
    mechanism (not silently orphaned) before its rows disappear."""
    project_id, cookies = await _create_bare_project()
    async with async_session_factory() as session:
        job = await job_repo.create(
            session,
            project_id=project_id,
            owner_id=uuid.uuid4(),
            job_type=JobType.export,
        )
        await job_repo.update_status(
            session, job.id, status=JobStatus.processing, progress=None
        )
        job_id = job.id

    response = await _delete(project_id, cookies)

    assert response.status_code == 204
    # The cancel flag was set (and, had a pid been tracked, a kill signal
    # sent) - cleared again here only because delete_project's own
    # job_repo.delete_by_project already removed the row this flag was
    # keyed to, so nothing will ever read it again either way.
    assert await redis_integration.is_export_cancel_requested(str(job_id)) is True
