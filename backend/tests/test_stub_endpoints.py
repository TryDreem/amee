import uuid

import pytest
from fastapi.testclient import TestClient

SAMPLE_UUID = str(uuid.uuid4())

ROUTES: list[tuple[str, str, dict[str, object] | None]] = [
    ("POST", "/api/v1/projects", None),
    ("GET", "/api/v1/projects", None),
    ("GET", f"/api/v1/projects/{SAMPLE_UUID}", None),
    ("POST", f"/api/v1/projects/{SAMPLE_UUID}/transcribe", None),
    ("GET", f"/api/v1/jobs/{SAMPLE_UUID}", None),
    ("GET", f"/api/v1/projects/{SAMPLE_UUID}/raw-transcript", None),
    ("GET", f"/api/v1/projects/{SAMPLE_UUID}/ecs", None),
    ("PUT", f"/api/v1/projects/{SAMPLE_UUID}/ecs", {"segments": []}),
    ("GET", f"/api/v1/projects/{SAMPLE_UUID}/style", None),
    (
        "PUT",
        f"/api/v1/projects/{SAMPLE_UUID}/style",
        {"presetId": SAMPLE_UUID, "overrides": {}},
    ),
    ("GET", "/api/v1/presets", None),
    (
        "POST",
        f"/api/v1/projects/{SAMPLE_UUID}/recalculate-groups",
        {"words": []},
    ),
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
