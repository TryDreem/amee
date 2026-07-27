from app.integrations.whisperx import TranscribedWord
from app.services.splitter import apply_breaks, split_words


def _word(text: str, start: float) -> TranscribedWord:
    return TranscribedWord(text=text, start=start, end=start + 0.3)


def test_empty_input_returns_no_groups() -> None:
    assert split_words([]) == []


def test_short_input_stays_in_one_group() -> None:
    words = [_word("hi", 0.0), _word("there", 0.3)]
    groups = split_words(words)
    assert groups == [words]


def test_splits_when_word_count_exceeds_limit() -> None:
    words = [_word(f"w{i}", i * 0.3) for i in range(10)]
    groups = split_words(words)
    assert len(groups) > 1
    assert sum(len(g) for g in groups) == len(words)
    for group in groups:
        assert len(group) <= 8


def test_splits_when_char_budget_exceeds_limit() -> None:
    words = [_word("x" * 40, 0.0), _word("word", 1.0)]
    groups = split_words(words)
    assert len(groups) == 2
    assert groups[0] == [words[0]]
    assert groups[1] == [words[1]]


def test_word_order_is_preserved_within_and_across_groups() -> None:
    words = [_word(f"w{i}", i * 0.3) for i in range(20)]
    groups = split_words(words)
    flattened = [w for group in groups for w in group]
    assert flattened == words


def test_apply_breaks_with_no_breaks_returns_one_group() -> None:
    words = [_word(f"w{i}", i * 0.3) for i in range(5)]
    assert apply_breaks(words, []) == [words]


def test_apply_breaks_every_word_its_own_group_except_last() -> None:
    words = [_word(f"w{i}", i * 0.3) for i in range(4)]
    groups = apply_breaks(words, [0, 1, 2])
    assert groups == [[words[0]], [words[1]], [words[2]], [words[3]]]


def test_apply_breaks_preserves_word_identity_and_order() -> None:
    words = [_word(f"w{i}", i * 0.3) for i in range(10)]
    groups = apply_breaks(words, [2, 5])
    flattened = [w for group in groups for w in group]
    assert flattened == words
    assert groups == [words[0:3], words[3:6], words[6:10]]
