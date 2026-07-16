from typing import Protocol, TypeVar

# Coarse heuristic only (arch §5.1) — no style input, ever (INVARIANTS P4). These
# numbers aren't tuned against real subtitle-readability research; they just keep
# groups short enough to be plausible captions until the Layout Engine (§8) does
# the real, pixel-accurate fit check later.
_MAX_WORDS_PER_SEGMENT = 8
_MAX_CHARS_PER_SEGMENT = 42


class _HasText(Protocol):
    # A read-only property, not a plain attribute — a plain `text: str`
    # would implicitly require the attribute to be settable too, which a
    # frozen dataclass (TranscribedWord) structurally fails even though it
    # obviously has a readable .text.
    @property
    def text(self) -> str: ...


# Generic over anything with `.text` — the heuristic never reads .start/.end,
# so this works unchanged for both the transcribe job's TranscribedWord
# (no id) and POST /recalculate-groups' wire-schema Word (has a client id
# that must survive regrouping untouched, contract §10).
T = TypeVar("T", bound=_HasText)


def split_words(words: list[T]) -> list[list[T]]:
    """`Words[] -> Segments[]` (arch §5.1, §5.3) — the only interface any
    splitter implementation, current or future, is allowed to depend on."""
    groups: list[list[T]] = []
    current: list[T] = []
    current_chars = 0

    for word in words:
        added_chars = len(word.text) + (1 if current else 0)
        if current and (
            len(current) >= _MAX_WORDS_PER_SEGMENT
            or current_chars + added_chars > _MAX_CHARS_PER_SEGMENT
        ):
            groups.append(current)
            current = []
            current_chars = 0
            added_chars = len(word.text)
        current.append(word)
        current_chars += added_chars

    if current:
        groups.append(current)
    return groups
