import asyncio
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations import storage
from app.integrations.whisperx import transcribe_video
from app.models.raw_transcript import RawTranscriptModel
from app.repositories import project as project_repo
from app.repositories import raw_transcript as raw_transcript_repo
from app.schemas.raw_transcript import RawTranscript, RawTranscriptWord


def _to_schema(model: RawTranscriptModel) -> RawTranscript:
    return RawTranscript(
        project_id=model.project_id,
        owner_id=model.owner_id,
        words=[
            RawTranscriptWord(
                text=str(word["text"]),
                start=float(word["start"]),
                end=float(word["end"]),
            )
            for word in model.words
        ],
        language=model.language,
    )


async def create_raw_transcript(
    session: AsyncSession, project_id: uuid.UUID
) -> RawTranscript:
    """Runs WhisperX against the project's stored video and persists the
    result. Called exactly once per project (P1) — from the transcribe task,
    never from a route directly."""
    project = await project_repo.get(session, project_id)
    if project is None:
        raise ValueError(f"project {project_id} not found")

    video_path = await storage.resolve_url(project.video_url)
    # WhisperX is a synchronous, CPU-bound call — run it off the event loop
    # so the other three branches of the transcribe job (arch §2.8b-d), all
    # genuinely async ffmpeg subprocesses, can actually run concurrently
    # with it rather than waiting behind a blocked loop.
    transcription = await asyncio.to_thread(
        transcribe_video, video_path, language=project.language
    )
    if not transcription.words:
        # WhisperX ran successfully but found nothing to transcribe - silence, music-only audio,
        # or speech below its confidence threshold. Left unchecked, this used to persist an empty
        # Raw Transcript, then an empty ECS, and the transcribe job would still land on `done`:
        # a project with a real video and zero captions, with nothing telling the user why.
        # Raising here propagates through _run_transcribe's existing try/except (app/workers/
        # tasks.py) into `Job.status = "failed"` with a clear message - the same mechanism
        # already used for the duration-cap rejection, not a new failure path.
        raise ValueError("no speech detected in this video")

    model = await raw_transcript_repo.create(
        session,
        project_id=project_id,
        owner_id=project.owner_id,
        words=[
            {"text": w.text, "start": w.start, "end": w.end}
            for w in transcription.words
        ],
        language=transcription.language,
    )
    return _to_schema(model)


async def get_raw_transcript(
    session: AsyncSession, project_id: uuid.UUID
) -> RawTranscript | None:
    model = await raw_transcript_repo.get_by_project(session, project_id)
    return _to_schema(model) if model else None
