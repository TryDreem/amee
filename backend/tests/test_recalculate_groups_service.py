import uuid

from app.schemas.ecs import Word
from app.schemas.recalculate import RecalculateGroupsRequest
from app.services import recalculate as recalculate_service
from app.services.splitter import split_words


def _word(text: str, start: float) -> Word:
    return Word(id=uuid.uuid4(), text=text, start=start, end=start + 0.3)


def test_recalculate_groups_matches_split_words_directly() -> None:
    words = [_word(f"w{i}", i * 0.3) for i in range(10)]
    body = RecalculateGroupsRequest(words=words)

    result = recalculate_service.recalculate_groups(body)

    expected_groups = split_words(words)
    assert [seg.words for seg in result.segments] == expected_groups


def test_recalculate_groups_preserves_word_ids() -> None:
    words = [_word("hello", 0.0), _word("world", 0.4)]
    body = RecalculateGroupsRequest(words=words)

    result = recalculate_service.recalculate_groups(body)

    flattened = [w for seg in result.segments for w in seg.words]
    assert [w.id for w in flattened] == [w.id for w in words]


def test_recalculate_groups_mints_fresh_segment_ids() -> None:
    words = [_word("hi", 0.0)]
    body = RecalculateGroupsRequest(words=words)

    result = recalculate_service.recalculate_groups(body)

    assert all(isinstance(seg.id, uuid.UUID) for seg in result.segments)
