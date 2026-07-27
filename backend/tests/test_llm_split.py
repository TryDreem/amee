import json
import os
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any
from unittest.mock import patch

import httpx
import pytest

from app.integrations.llm_split import LlmSplitError, request_breaks
from app.integrations.whisperx import TranscribedWord


def _word(text: str, start: float) -> TranscribedWord:
    return TranscribedWord(text=text, start=start, end=start + 0.3)


def _chat_response(content: str) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


@contextmanager
def _mocked_transport(
    handler: Callable[[httpx.Request], httpx.Response],
) -> Iterator[None]:
    original_init = httpx.AsyncClient.__init__

    def patched_init(self: httpx.AsyncClient, *args: Any, **kwargs: Any) -> None:
        kwargs["transport"] = httpx.MockTransport(handler)
        original_init(self, *args, **kwargs)

    with (
        patch.dict("os.environ", {"AMEE_LLM_SPLIT_API_KEY": "test-key"}),
        patch.object(httpx.AsyncClient, "__init__", patched_init),
    ):
        yield


async def test_request_breaks_parses_well_formed_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return _chat_response(json.dumps({"breaks": [4, 9]}))

    with _mocked_transport(handler):
        breaks = await request_breaks(
            [_word(f"w{i}", i * 0.3) for i in range(10)],
            language="en",
            max_words=8,
            max_chars=42,
        )
    assert breaks == [4, 9]


async def test_request_breaks_sends_word_text_for_real_semantic_splitting() -> None:
    """Confirmed with the human: the LLM needs the actual words to find real
    clause/sentence boundaries (pause length + position alone can't do it).
    Safety comes from the *output* being index-only (see the malformed-
    response tests below), not from hiding the input text."""
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = request.content.decode()
        return _chat_response(json.dumps({"breaks": [1]}))

    words = [_word("hello", 0.0), _word("world", 1.0)]
    with _mocked_transport(handler):
        await request_breaks(words, language="en", max_words=8, max_chars=42)

    assert "hello" in captured["body"]
    assert "world" in captured["body"]


@pytest.mark.parametrize(
    "content",
    [
        "not json at all",
        json.dumps({"no_breaks_key": True}),
        json.dumps({"breaks": "not-a-list"}),
        json.dumps({"breaks": [1, "two", 3]}),
        json.dumps({"breaks": [1, True, 3]}),
    ],
)
async def test_request_breaks_raises_on_malformed_response(content: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return _chat_response(content)

    with _mocked_transport(handler), pytest.raises(LlmSplitError):
        await request_breaks(
            [_word("hi", 0.0)], language="en", max_words=8, max_chars=42
        )


async def test_request_breaks_raises_on_non_200_status() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="internal error")

    with _mocked_transport(handler), pytest.raises(LlmSplitError):
        await request_breaks(
            [_word("hi", 0.0)], language="en", max_words=8, max_chars=42
        )


async def test_request_breaks_raises_on_timeout() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("timed out", request=request)

    with _mocked_transport(handler), pytest.raises(LlmSplitError):
        await request_breaks(
            [_word("hi", 0.0)], language="en", max_words=8, max_chars=42
        )


async def test_request_breaks_raises_llm_split_error_when_api_key_missing() -> None:
    """A missing/misconfigured API key must raise LlmSplitError, not a bare
    KeyError - otherwise it bypasses smart_splitter's per-attempt retry
    handling entirely (it only catches LlmSplitError)."""
    with patch.dict("os.environ", {}, clear=False):
        os.environ.pop("AMEE_LLM_SPLIT_API_KEY", None)
        with pytest.raises(LlmSplitError, match="AMEE_LLM_SPLIT_API_KEY"):
            await request_breaks(
                [_word("hi", 0.0)], language="en", max_words=8, max_chars=42
            )
