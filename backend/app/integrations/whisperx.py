from dataclasses import dataclass
from pathlib import Path

# "tiny" + CPU + int8: small enough to run without a GPU, which is what MVP
# scale (arch §1.2) actually needs — swap via a bigger model name later if
# transcription quality demands it, without touching the interface below.
_MODEL_NAME = "tiny"
_DEVICE = "cpu"
_COMPUTE_TYPE = "int8"


@dataclass(frozen=True)
class TranscribedWord:
    text: str
    start: float
    end: float


def transcribe_video(path: Path, language: str | None = None) -> list[TranscribedWord]:
    """Word-level transcript via WhisperX (arch §1.3) — called exactly once
    per video (P1), never re-invoked by later edits.

    `language` (arch §2.9): an ISO 639-1 code passed straight through to
    WhisperX, skipping its own auto-detection. `None` (the default) leaves
    `load_model`'s call exactly as it was before this parameter existed -
    WhisperX auto-detects from the first ~30s of audio, same as today.

    Imports whisperx lazily, inside the function, rather than at module
    level: it's a dev-only extra (backend/pyproject.toml's "ml" group, not
    installed in CI — see tests/conftest.py), and this function is the only
    thing in the module that actually needs it. A module-level import would
    force every caller of app.main (including `make types`' plain
    `python -c "import app.main"` OpenAPI dump, which never touches this
    function) to have the package installed just to boot."""
    import whisperx

    model_kwargs: dict[str, object] = {"compute_type": _COMPUTE_TYPE}
    if language is not None:
        model_kwargs["language"] = language
    model = whisperx.load_model(_MODEL_NAME, _DEVICE, **model_kwargs)
    audio = whisperx.load_audio(str(path))
    result = model.transcribe(audio)

    align_model, metadata = whisperx.load_align_model(
        language_code=result["language"], device=_DEVICE
    )
    aligned = whisperx.align(result["segments"], align_model, metadata, audio, _DEVICE)

    words: list[TranscribedWord] = []
    for word in aligned["word_segments"]:
        if "start" not in word or "end" not in word:
            # WhisperX occasionally can't align a word to the audio — drop it
            # rather than fabricate a timestamp (D4: no invented timing).
            continue
        words.append(
            TranscribedWord(
                text=word["word"], start=float(word["start"]), end=float(word["end"])
            )
        )
    return words
