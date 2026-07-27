import json
import os
from typing import Any, Protocol, TypeVar

import httpx

# Groq: fast, generous free tier, hosts Llama 3.3 70B, OpenAI-chat-completions
# -shaped API. Swapping providers later (e.g. x.ai's Grok, also OpenAI-shaped)
# is a _BASE_URL/_MODEL change only - no other code here is Groq-specific.
_BASE_URL = "https://api.groq.com/openai/v1/chat/completions"
_MODEL = "llama-3.3-70b-versatile"
_TIMEOUT_SECONDS = 30.0

# Gaps at or below this are noise, not a meaningful pause signal - omitted
# from the payload entirely rather than sent as a near-zero float.
_GAP_THRESHOLD_SECONDS = 0.2

# The prompt states limits slightly under the real ones (validated by
# smart_splitter.validate_breaks against splitter.py's actual constants) so
# the model's typical off-by-one-or-two miscount still lands inside the real
# bound - cuts down on retries without loosening the actual invariant.
_PROMPT_WORDS_MARGIN = 1
_PROMPT_CHARS_MARGIN = 2


class LlmSplitError(RuntimeError):
    """Any failure to obtain a well-formed breaks response: HTTP error,
    timeout, non-200, malformed JSON, or a response shaped wrong (missing
    `breaks` key, not a list, elements not plain ints)."""


class _HasTiming(Protocol):
    @property
    def text(self) -> str: ...
    @property
    def start(self) -> float: ...
    @property
    def end(self) -> float: ...


T = TypeVar("T", bound=_HasTiming)


def _build_payload(words: list[T], language: str) -> dict[str, Any]:
    """Sends `.text` alongside index + gap-before-word (seconds, omitted
    when <= _GAP_THRESHOLD_SECONDS or for the first word) + the project's
    language - the LLM needs the actual words to make a real semantic/
    clause-boundary judgment call (pause length + position alone can't
    distinguish "СОВСЕМ СКОРО НА МОЁМ КАНАЛЕ" from "БУДЕТ ЮБИЛЕЙ" the way
    grammar can). This does NOT weaken the design's safety property: the
    LLM's *output* is index-only (`request_breaks` returns `list[int]`,
    never text), so segments are still always reconstructed from the
    backend's own already-known Word objects by index - the LLM cannot
    inject, rewrite, or drop word content no matter what it echoes back.
    Sending text here is a deliberate privacy trade-off (transcript
    content leaves the machine to the LLM provider), confirmed with the
    human - not an oversight."""
    indexed_words: list[dict[str, Any]] = []
    for i, word in enumerate(words):
        gap: float | None = None
        if i > 0:
            candidate = word.start - words[i - 1].end
            if candidate > _GAP_THRESHOLD_SECONDS:
                gap = round(candidate, 2)
        indexed_words.append({"i": i, "text": word.text, "gap_before": gap})
    return {"words": indexed_words, "language": language}


def _system_prompt(max_words: int, max_chars: int) -> str:
    # max_words/max_chars are threaded in from splitter.py's own constants at
    # call time (see request_breaks) rather than hand-typed here, so a future
    # constant change can't silently desync this prompt from the validator.
    return (
        "You segment transcribed speech into caption groups by meaning, for "
        "a word-highlighting subtitle editor. You will receive a JSON object "
        '{"words": [{"i": <index>, "text": <word>, "gap_before": <seconds or '
        'null>}, ...], "language": "<code>"} - an ordered list of words with '
        "the pause (in seconds) before each word, and the transcript's "
        "language. Use the actual words and grammar to find real clause/"
        "sentence boundaries, not just pause length or word count.\n\n"
        'Return ONLY a JSON object {"breaks": [<index>, <index>, ...]} - '
        "no prose, no markdown fences, and never echo back any word text. "
        "Each value in `breaks` is the index of the LAST word of a caption "
        "group: breaks [4, 9] on a 10-word input means group 1 = words 0-4, "
        "group 2 = words 5-9, group 3 = words 10 to the end. `breaks` must "
        "be strictly increasing and never include the very last word's "
        "index (nothing would follow it).\n\n"
        f"Hard limits, do not exceed: at most {max_words} words per group, "
        f"at most {max_chars} characters per group. Prefer breaking at "
        "natural clause/sentence boundaries first, using the largest pauses "
        "as a secondary signal when a sentence has more than one plausible "
        "break point."
    )


async def request_breaks(
    words: list[T],
    *,
    language: str,
    max_words: int,
    max_chars: int,
    feedback: str | None = None,
) -> list[int]:
    """One HTTP call to the configured LLM provider. Returns the raw
    `breaks` list exactly as returned - does not validate business rules
    (`app.services.smart_splitter` owns that) and does not retry internally
    (the attempt budget lives one layer up, in `smart_splitter.try_smart_
    split`), so this function has exactly one HTTP call's worth of
    responsibility. Raises LlmSplitError on any failure to get a
    well-formed response, including a missing/misconfigured API key - a bare
    KeyError there would bypass smart_splitter's per-attempt LlmSplitError
    handling entirely (raising immediately on attempt 1, no retry, and a
    confusing raw KeyError repr as the only trace of what happened)."""
    try:
        api_key = os.environ["AMEE_LLM_SPLIT_API_KEY"]
    except KeyError as exc:
        raise LlmSplitError(
            "AMEE_LLM_SPLIT_API_KEY environment variable is not set"
        ) from exc

    user_content = json.dumps(_build_payload(words, language))
    if feedback is not None:
        user_content += f"\n\nYour previous attempt was invalid: {feedback}"

    body = {
        "model": _MODEL,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": _system_prompt(
                    max_words - _PROMPT_WORDS_MARGIN, max_chars - _PROMPT_CHARS_MARGIN
                ),
            },
            {"role": "user", "content": user_content},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.post(
                _BASE_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                json=body,
            )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        parsed = json.loads(content)
    except httpx.HTTPError as exc:
        raise LlmSplitError(f"request to LLM provider failed: {exc}") from exc
    except (KeyError, IndexError, json.JSONDecodeError) as exc:
        raise LlmSplitError(f"malformed response from LLM provider: {exc}") from exc

    breaks = parsed.get("breaks") if isinstance(parsed, dict) else None
    if not isinstance(breaks, list) or not all(
        isinstance(b, int) and not isinstance(b, bool) for b in breaks
    ):
        raise LlmSplitError(f"response 'breaks' is not a list of ints: {parsed!r}")
    return breaks
