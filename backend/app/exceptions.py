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
