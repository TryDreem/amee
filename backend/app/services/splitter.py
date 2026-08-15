from typing import Protocol, TypeVar

# Coarse heuristic only (arch §5.1) — no style input, ever (INVARIANTS P4). These
# numbers aren't tuned against real subtitle-readability research; they just keep
# groups short enough to be plausible captions until the Layout Engine (§8) does
# the real, pixel-accurate fit check later.
_MAX_WORDS_PER_SEGMENT = 8
_MAX_CHARS_PER_SEGMENT = 30


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


def apply_breaks(words: list[T], breaks: list[int]) -> list[list[T]]:
    """A second, generic `Words[] -> Segments[]` implementation (arch §5.3's
    "AI semantic splitter" branch, P4): reconstructs segments by cutting
    `words` after each index in `breaks`. Segment 0 is `words[0:breaks[0]+1]`,
    segment i is `words[breaks[i-1]+1 : breaks[i]+1]`, and the final segment
    runs from the last break to the end of `words`. Does not itself validate
    `breaks` — the caller (`smart_splitter.validate_breaks`) must already
    have confirmed they're strictly increasing and in range before this is
    called; passing invalid breaks here produces undefined grouping, not a
    raised error."""
    groups: list[list[T]] = []
    start = 0
    for br in breaks:
        groups.append(words[start : br + 1])
        start = br + 1
    groups.append(words[start:])
    return groups
