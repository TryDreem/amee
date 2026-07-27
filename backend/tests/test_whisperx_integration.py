import sys
from pathlib import Path
from unittest.mock import MagicMock, patch


def _install_fake_whisperx() -> MagicMock:
    """`app.integrations.whisperx.transcribe_video` does `import whisperx`
    *inside* the function (module docstring explains why: it's the optional
    `ml` extra, not installed in CI). Patching `app.integrations.whisperx.
    whisperx` therefore does nothing - the name doesn't exist at module
    scope. Injecting a fake module into `sys.modules` is what the lazy
    import actually picks up."""
    fake = MagicMock(spec_set=["load_model", "load_audio", "load_align_model", "align"])
    model = MagicMock()
    model.transcribe.return_value = {"segments": [], "language": "en"}
    fake.load_model.return_value = model
    fake.load_audio.return_value = "fake-audio"
    fake.load_align_model.return_value = (MagicMock(), MagicMock())
    fake.align.return_value = {"word_segments": []}
    return fake


def test_transcribe_video_omits_language_kwarg_when_none() -> None:
    fake_whisperx = _install_fake_whisperx()
    with patch.dict(sys.modules, {"whisperx": fake_whisperx}):
        from app.integrations.whisperx import transcribe_video

        transcription = transcribe_video(Path("/tmp/whatever.mp4"), language=None)

    _, kwargs = fake_whisperx.load_model.call_args
    assert "language" not in kwargs
    # WhisperX's own auto-detection result ("en", from the mocked
    # model.transcribe() return value) is surfaced on the result, not
    # discarded - this is what Step 14's smart-split gate reads when the
    # user picked "auto" and Project.language stays null forever.
    assert transcription.language == "en"


def test_transcribe_video_passes_language_kwarg_when_set() -> None:
    fake_whisperx = _install_fake_whisperx()
    with patch.dict(sys.modules, {"whisperx": fake_whisperx}):
        from app.integrations.whisperx import transcribe_video

        transcribe_video(Path("/tmp/whatever.mp4"), language="ru")

    _, kwargs = fake_whisperx.load_model.call_args
    assert kwargs["language"] == "ru"
