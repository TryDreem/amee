import uuid

from app.schemas.ecs import Segment
from app.schemas.recalculate import RecalculateGroupsRequest, RecalculateGroupsResult
from app.services.splitter import split_words


def recalculate_groups(body: RecalculateGroupsRequest) -> RecalculateGroupsResult:
    """Stateless exposure of the Initial Splitter (arch §5.1, contract §10)
    over the *live* frontend `Words[]` sent in the request body, not
    whatever was last saved. No DB session, no persistence, no undo-stack
    involvement (E6) — the frontend adopts the result itself. New segment
    ids are minted fresh; word ids are the client's own, untouched by
    regrouping (D10)."""
    groups = split_words(body.words)
    return RecalculateGroupsResult(
        segments=[Segment(id=uuid.uuid4(), words=list(group)) for group in groups]
    )
