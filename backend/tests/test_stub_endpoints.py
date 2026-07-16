import uuid

import pytest
from fastapi.testclient import TestClient

SAMPLE_UUID = str(uuid.uuid4())

ROUTES: list[tuple[str, str, dict[str, object] | None]] = [
    # POST/GET /projects and GET /projects/{id} are real now (M1 step 3) -
    # see test_projects_endpoint.py instead.
    # POST /transcribe is real now (M1 step 7) - see test_transcribe_endpoint.py.
    # GET /jobs/{id} is real now (M1 step 4) - see test_jobs_endpoint.py.
    # GET /raw-transcript is real now (M1 step 5) - see test_raw_transcript_endpoint.py.
    # GET /ecs is real now (M1 step 6) - see test_ecs_endpoint.py.
    # PUT /ecs is real now (M2 step 4) - see test_ecs_endpoint.py.
    # GET/PUT /style are real now (M2 step 3) - see test_style_endpoint.py.
    # GET /presets is real now (M2 step 1) - see test_presets_endpoint.py.
    # POST /recalculate-groups is real now (M2 step 5) - see test_recalculate_groups_endpoint.py.
    ("POST", f"/api/v1/projects/{SAMPLE_UUID}/reset-to-raw", None),
    (
        "POST",
        f"/api/v1/projects/{SAMPLE_UUID}/export",
        {
            "ecs": {"segments": []},
            "style": {"presetId": SAMPLE_UUID, "overrides": {}},
        },
    ),
]


@pytest.mark.parametrize(
    "method,path,body", ROUTES, ids=[f"{m} {p}" for m, p, _ in ROUTES]
)
def test_stub_returns_501(
    client: TestClient, method: str, path: str, body: dict[str, object] | None
) -> None:
    response = client.request(method, path, json=body)
    assert response.status_code == 501
    payload = response.json()
    assert payload["error"]["code"] == "not_implemented"
    assert isinstance(payload["error"]["message"], str)
    assert payload["error"]["details"] == []
