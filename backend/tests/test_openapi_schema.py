from app.main import app

EXPECTED: dict[str, set[str]] = {
    # Auth resource — implemented ahead of docs/api-contract.md's own §15, which is a
    # hook-protected file and is currently a diff pending the human's sign-off, not yet applied.
    # Same sequencing already used for export-srt below: code + this test land first, the
    # contract catches up. Only /me and /logout exist so far (auth plan, step 3) — /google/start,
    # /google/callback, /me/avatar are later steps.
    "/api/v1/auth/me": {"get"},
    "/api/v1/auth/logout": {"post"},
    "/api/v1/projects": {"post", "get"},
    "/api/v1/projects/{project_id}": {"get", "delete"},
    "/api/v1/projects/{project_id}/open": {"post"},
    "/api/v1/projects/{project_id}/transcribe": {"post"},
    "/api/v1/jobs/{job_id}": {"get"},
    "/api/v1/projects/{project_id}/jobs/{job_id}/cancel": {"post"},
    "/api/v1/projects/{project_id}/raw-transcript": {"get"},
    "/api/v1/projects/{project_id}/ecs": {"get", "put"},
    "/api/v1/projects/{project_id}/style": {"get", "put"},
    "/api/v1/presets": {"get"},
    "/api/v1/projects/{project_id}/recalculate-groups": {"post"},
    "/api/v1/projects/{project_id}/reset-to-raw": {"post"},
    "/api/v1/projects/{project_id}/export": {"post"},
    "/api/v1/projects/{project_id}/export-srt": {"post"},
}


def test_openapi_has_exactly_the_contract_paths() -> None:
    schema = app.openapi()
    paths = schema["paths"]

    assert set(paths.keys()) == set(EXPECTED.keys())
    for path, methods in EXPECTED.items():
        assert set(paths[path].keys()) == methods, path


def test_openapi_route_count_matches_contract() -> None:
    """20 routes: the 18 across the 10 resource groups in api-contract.md §3, plus 2 from the
    proposed Auth resource (§15, not yet applied — see the comment on EXPECTED above)."""
    schema = app.openapi()
    route_count = sum(len(methods) for methods in schema["paths"].values())
    assert route_count == 20
