from app.main import app

EXPECTED: dict[str, set[str]] = {
    "/api/v1/projects": {"post", "get"},
    "/api/v1/projects/{project_id}": {"get"},
    "/api/v1/projects/{project_id}/open": {"post"},
    "/api/v1/projects/{project_id}/transcribe": {"post"},
    "/api/v1/jobs/{job_id}": {"get"},
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
    """16 routes across the 10 resource groups in api-contract.md §3."""
    schema = app.openapi()
    route_count = sum(len(methods) for methods in schema["paths"].values())
    assert route_count == 16
