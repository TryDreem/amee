import uuid

from app.schemas.common import ErrorDetail
from app.schemas.ecs import Segment
from app.schemas.preset import PresetBounds
from app.services.style_validation import validate_overrides


def validate_segments(
    segments: list[Segment], bounds: PresetBounds
) -> list[ErrorDetail]:
    """Server-side ECS validation (arch §4.2, contract §7) — V1-V5, plus V8
    (segment.overrides, when present, checked against the same resolved
    preset bounds PUT /style uses) and V9 (id uniqueness within the
    document — contract §7 states it as the one hard requirement of the
    id lifecycle; without this check a duplicate id surfaces as a DB
    primary-key IntegrityError, a 500 instead of the contract's 422).
    Pure function over wire-schema objects so `PUT /ecs` and
    `POST /export` (contract §12's X5) share exactly one validation path,
    not two that can drift apart. V6 (minimum word duration) is
    deliberately excluded — a renderer concern, not a validation rule
    (INVARIANTS)."""
    details: list[ErrorDetail] = []

    seen_segment_ids: set[uuid.UUID] = set()
    seen_word_ids: set[uuid.UUID] = set()
    for seg_idx, segment in enumerate(segments):
        if segment.id in seen_segment_ids:
            details.append(
                ErrorDetail(
                    field=f"segments[{seg_idx}].id",
                    issue=f"duplicate segment id {segment.id}",  # V9
                )
            )
        seen_segment_ids.add(segment.id)
        for word_idx, word in enumerate(segment.words):
            if word.id in seen_word_ids:
                details.append(
                    ErrorDetail(
                        field=f"segments[{seg_idx}].words[{word_idx}].id",
                        issue=f"duplicate word id {word.id}",  # V9
                    )
                )
            seen_word_ids.add(word.id)

    for seg_idx, segment in enumerate(segments):
        if segment.overrides is not None:
            details.extend(
                validate_overrides(
                    segment.overrides,
                    bounds,
                    prefix=f"segments[{seg_idx}].overrides",
                )
            )

        if not segment.words:
            details.append(
                ErrorDetail(
                    field=f"segments[{seg_idx}]",
                    issue="segment must have at least one word",  # V5
                )
            )
            continue

        prev_end: float | None = None
        for word_idx, word in enumerate(segment.words):
            field = f"segments[{seg_idx}].words[{word_idx}]"
            if not word.text:
                details.append(
                    ErrorDetail(field=f"{field}.text", issue="text must not be empty")
                )  # V1
            if not word.start < word.end:
                details.append(
                    ErrorDetail(
                        field=field,
                        issue=f"start ({word.start}) must be less than end ({word.end})",
                    )
                )  # V2
            if prev_end is not None and word.start < prev_end:
                details.append(
                    ErrorDetail(
                        field=field,
                        issue=f"start ({word.start}) overlaps the previous word's end ({prev_end})",
                    )
                )  # V3
            prev_end = word.end

    # V4: segments must not overlap each other. Pairwise, not just
    # consecutive-in-list, since array order is authored (D7) and not
    # guaranteed to match chronological order.
    segment_spans = [
        (seg_idx, segment.words[0].start, segment.words[-1].end)
        for seg_idx, segment in enumerate(segments)
        if segment.words
    ]
    for i, (idx_a, start_a, end_a) in enumerate(segment_spans):
        for idx_b, start_b, end_b in segment_spans[i + 1 :]:
            if start_a < end_b and start_b < end_a:
                details.append(
                    ErrorDetail(
                        field=f"segments[{idx_b}]",
                        issue=f"overlaps segments[{idx_a}]",
                    )
                )

    return details
