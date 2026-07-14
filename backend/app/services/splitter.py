from app.integrations.whisperx import TranscribedWord

# Coarse heuristic only (arch §5.1) — no style input, ever (INVARIANTS P4). These
# numbers aren't tuned against real subtitle-readability research; they just keep
# groups short enough to be plausible captions until the Layout Engine (§8) does
# the real, pixel-accurate fit check later.
_MAX_WORDS_PER_SEGMENT = 8
_MAX_CHARS_PER_SEGMENT = 42


def split_words(words: list[TranscribedWord]) -> list[list[TranscribedWord]]:
    """`Words[] -> Segments[]` (arch §5.1, §5.3) — the only interface any
    splitter implementation, current or future, is allowed to depend on."""
    groups: list[list[TranscribedWord]] = []
    current: list[TranscribedWord] = []
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
