import logging
from typing import Protocol, TypeVar

from app.integrations import llm_split
from app.integrations.llm_split import LlmSplitError
from app.services import splitter
from app.services.language import SMART_SPLIT_LANGUAGES

logger = logging.getLogger(__name__)

_MAX_ATTEMPTS = 3


class _HasTiming(Protocol):
    @property
    def text(self) -> str: ...
    @property
    def start(self) -> float: ...
    @property
    def end(self) -> float: ...


T = TypeVar("T", bound=_HasTiming)


def validate_breaks(breaks: list[int], words: list[T]) -> str | None:
    """`None` = valid. A `str` = a precise, LLM-readable diagnostic of the
    FIRST violation found (first-violation-wins keeps retry feedback short
    and actionable, rather than dumping every problem into one message).
    Checks, in order: (1) strictly increasing; (2) each break in
    `[0, len(words)-2]` (the last word can't be a break point - there'd be
    nothing after it); (3) each reconstructed segment respects
    `splitter._MAX_WORDS_PER_SEGMENT`/`_MAX_CHARS_PER_SEGMENT` (imported,
    never redefined, so the two can't drift apart)."""
    if not words:
        return "no words to split"

    last_valid_index = len(words) - 2
    prev = -1
    for b in breaks:
        if b <= prev:
            return f"breaks must be strictly increasing, got {prev} then {b}"
        if b < 0 or b > last_valid_index:
            return (
                f"break index {b} is out of range - only {len(words)} words "
                f"exist (valid range 0-{last_valid_index})"
            )
        prev = b

    groups = splitter.apply_breaks(words, breaks)
    word_offset = 0
    for group in groups:
        if len(group) > splitter._MAX_WORDS_PER_SEGMENT:
            return (
                f"segment covering words {word_offset}-{word_offset + len(group) - 1} "
                f"has {len(group)} words (max {splitter._MAX_WORDS_PER_SEGMENT}) - "
                "split it further"
            )
        chars = sum(len(w.text) for w in group) + max(len(group) - 1, 0)
        if chars > splitter._MAX_CHARS_PER_SEGMENT:
            return (
                f"segment covering words {word_offset}-{word_offset + len(group) - 1} "
                f"has {chars} characters (max {splitter._MAX_CHARS_PER_SEGMENT}) - "
                "split it further"
            )
        word_offset += len(group)
    return None


async def try_smart_split(
    words: list[T], *, language: str | None
) -> list[list[T]] | None:
    """`None` = smart-split doesn't apply (language not in
    `SMART_SPLIT_LANGUAGES`) or exhausted all attempts without a valid
    result - both are non-error outcomes; the caller (`workers.tasks`) keeps
    the dumb split either way. Network/parse failures (`LlmSplitError`) and
    validation failures are treated identically against the attempt budget
    (confirmed with the human): one counter, one loop, and a persistently
    unreachable provider still degrades to the same accepted fallback,
    just faster."""
    if language not in SMART_SPLIT_LANGUAGES:
        return None

    feedback: str | None = None
    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            breaks = await llm_split.request_breaks(
                words,
                language=language,
                max_words=splitter._MAX_WORDS_PER_SEGMENT,
                max_chars=splitter._MAX_CHARS_PER_SEGMENT,
                feedback=feedback,
            )
        except LlmSplitError as exc:
            logger.warning(
                "smart-split attempt %d/%d failed for language=%s: %s",
                attempt,
                _MAX_ATTEMPTS,
                language,
                exc,
            )
            feedback = str(exc)
            continue
        diagnostic = validate_breaks(breaks, words)
        if diagnostic is None:
            logger.info(
                "smart-split attempt %d/%d valid: %d words -> %d groups",
                attempt,
                _MAX_ATTEMPTS,
                len(words),
                len(breaks) + 1,
            )
            return splitter.apply_breaks(words, breaks)
        logger.warning(
            "smart-split attempt %d/%d produced invalid breaks: %s",
            attempt,
            _MAX_ATTEMPTS,
            diagnostic,
        )
        feedback = diagnostic
    logger.warning(
        "smart-split exhausted all %d attempts for language=%s - keeping the dumb split",
        _MAX_ATTEMPTS,
        language,
    )
    return None
