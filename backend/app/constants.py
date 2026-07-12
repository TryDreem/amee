import uuid

# Every entity except Preset carries owner_id; MVP resolves it to one
# hardcoded placeholder until real auth lands (arch §2.4, INVARIANTS D9).
# Same value used in frontend/src/mocks/fixtures.ts and api-contract.md §12's
# own example — one placeholder, not a different one per layer.
PLACEHOLDER_OWNER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
