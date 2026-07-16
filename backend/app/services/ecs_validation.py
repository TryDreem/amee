from app.schemas.common import ErrorDetail
from app.schemas.ecs import Segment


def validate_segments(segments: list[Segment]) -> list[ErrorDetail]:
    """Server-side ECS validation (arch §4.2, contract §7) — V1-V5. Pure
    function over wire-schema objects so `PUT /ecs` and `POST /export`
    (contract §12's X5) share exactly one validation path, not two that can
    drift apart. V6 (minimum word duration) is deliberately excluded — a
    renderer concern, not a validation rule (INVARIANTS)."""
    details: list[ErrorDetail] = []

    for seg_idx, segment in enumerate(segments):
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
    bounds = [
        (seg_idx, segment.words[0].start, segment.words[-1].end)
        for seg_idx, segment in enumerate(segments)
        if segment.words
    ]
    for i, (idx_a, start_a, end_a) in enumerate(bounds):
        for idx_b, start_b, end_b in bounds[i + 1 :]:
            if start_a < end_b and start_b < end_a:
                details.append(
                    ErrorDetail(
                        field=f"segments[{idx_b}]",
                        issue=f"overlaps segments[{idx_a}]",
                    )
                )

    return details
