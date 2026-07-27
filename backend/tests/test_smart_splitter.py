from unittest.mock import AsyncMock, patch

from app.integrations.llm_split import LlmSplitError
from app.integrations.whisperx import TranscribedWord
from app.services.smart_splitter import try_smart_split, validate_breaks


def _word(text: str, start: float) -> TranscribedWord:
    return TranscribedWord(text=text, start=start, end=start + 0.3)


def _words(n: int) -> list[TranscribedWord]:
    return [_word(f"w{i}", i * 0.3) for i in range(n)]


def test_validate_breaks_valid_case_returns_none() -> None:
    words = _words(10)
    assert validate_breaks([2, 5], words) is None


def test_validate_breaks_not_strictly_increasing() -> None:
    words = _words(10)
    diagnostic = validate_breaks([5, 5], words)
    assert diagnostic is not None
    assert "strictly increasing" in diagnostic


def test_validate_breaks_out_of_range_too_high() -> None:
    words = _words(5)
    diagnostic = validate_breaks([4], words)  # last word (index 4) can't break
    assert diagnostic is not None
    assert "out of range" in diagnostic


def test_validate_breaks_segment_too_many_words() -> None:
    words = _words(20)
    diagnostic = validate_breaks([9], words)  # first group = 10 words > max 8
    assert diagnostic is not None
    assert "words" in diagnostic
    assert "0-9" in diagnostic


def test_validate_breaks_segment_too_many_chars() -> None:
    words = [_word("x" * 40, 0.0), _word("y" * 40, 1.0)]
    diagnostic = validate_breaks([], words)  # one group, 80+ chars
    assert diagnostic is not None
    assert "characters" in diagnostic


async def test_try_smart_split_skips_language_not_in_allowlist() -> None:
    words = _words(10)
    with patch(
        "app.services.smart_splitter.llm_split.request_breaks", new_callable=AsyncMock
    ) as mock_request:
        result = await try_smart_split(words, language="ja")
    assert result is None
    mock_request.assert_not_called()


async def test_try_smart_split_retries_with_feedback_then_succeeds() -> None:
    words = _words(10)
    with patch(
        "app.services.smart_splitter.llm_split.request_breaks", new_callable=AsyncMock
    ) as mock_request:
        mock_request.side_effect = [
            LlmSplitError("network blew up"),
            [9],  # out of range: last word (index 9) can't be a break point
            [4],  # valid: two groups of 5 words each
        ]
        result = await try_smart_split(words, language="en")

    assert result == [words[0:5], words[5:10]]
    assert mock_request.call_count == 3
    third_call_kwargs = mock_request.call_args_list[2].kwargs
    assert third_call_kwargs["feedback"] is not None


async def test_try_smart_split_returns_none_after_exhausting_attempts() -> None:
    words = _words(10)
    with patch(
        "app.services.smart_splitter.llm_split.request_breaks", new_callable=AsyncMock
    ) as mock_request:
        mock_request.side_effect = LlmSplitError("still broken")
        result = await try_smart_split(words, language="en")

    assert result is None
    assert mock_request.call_count == 3
