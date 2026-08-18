from app.schemas.common import ErrorDetail


class DomainValidationError(Exception):
    """Raised by services for domain-level validation failures (style
    bounds, ECS V1-V5, ...) that need structured `error.details` (contract
    §1) — plain HTTPException has no field-level detail list. One handler
    in app/main.py turns this into a 422, shared by every endpoint that
    validates (PUT /style, PUT /ecs, POST /export — contract §12's X5)."""

    def __init__(self, details: list[ErrorDetail]) -> None:
        self.details = details
        super().__init__(f"validation failed: {len(details)} issue(s)")


class RateLimitedError(Exception):
    """Raised by the rate-limit dependencies (app/api/v1/deps.py) when a fixed-window counter is
    exceeded. One handler in app/main.py turns this into the 429 shape already fixed in
    api-contract.md §1 - plain HTTPException has no way to carry the Retry-After/X-RateLimit-*
    headers or a structured `details` entry, same reasoning as DomainValidationError above."""

    def __init__(
        self, *, field: str, limit: int, remaining: int, reset_seconds: int
    ) -> None:
        self.field = field
        self.limit = limit
        self.remaining = remaining
        self.reset_seconds = reset_seconds
        super().__init__(f"rate limit exceeded: retry after {reset_seconds}s")
