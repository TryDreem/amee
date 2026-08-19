import uuid

import httpx
from httpx import ASGITransport

from app.db import async_session_factory
from app.integrations.session_cookie import sign_user_id
from app.integrations.whisperx import TranscribedWord
from app.main import app
from app.repositories import project as project_repo
from app.repositories import user as user_repo
from app.services import ecs as ecs_service
from app.services import style as style_service


async def _make_owner() -> uuid.UUID:
    async with async_session_factory() as session:
        user = await user_repo.create_guest(session)
    return user.id


def _cookies(owner_id: uuid.UUID) -> dict[str, str]:
    return {"amee_session": sign_user_id(owner_id)}


async def _make_transcribed_project() -> tuple[uuid.UUID, dict[str, str]]:
    owner_id = await _make_owner()
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=owner_id,
            name="PUT ecs test",
            video_url="/files/projects/z/source.mp4",
        )
        # PUT /ecs resolves the project's style/preset to validate
        # segment.overrides bounds (V8) - style is created eagerly at
        # upload in production (contract §4), so tests need it too.
        await style_service.create_default_style(
            session, project_id=project.id, owner_id=project.owner_id
        )
        await ecs_service.create_initial_ecs(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            words=[TranscribedWord(text="hi", start=0.0, end=0.3)],
        )
        return project.id, _cookies(owner_id)


async def test_get_ecs_not_found_before_transcription() -> None:
    owner_id = await _make_owner()
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=owner_id,
            name="ECS endpoint test",
            video_url="/files/projects/z/source.mp4",
        )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        cookies=_cookies(owner_id),
    ) as client:
        response = await client.get(f"/api/v1/projects/{project.id}/ecs")

        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"


async def test_get_ecs_owned_by_someone_else_is_not_found() -> None:
    """The IDOR/BOLA fix (require_project_owner) - a real project id that isn't the caller's own
    must read exactly like a nonexistent one."""
    project_id, _ = await _make_transcribed_project()

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/v1/projects/{project_id}/ecs")

    assert response.status_code == 404


async def test_get_ecs_returns_persisted_segments() -> None:
    owner_id = await _make_owner()
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=owner_id,
            name="ECS endpoint test 2",
            video_url="/files/projects/z/source.mp4",
        )
        await ecs_service.create_initial_ecs(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            words=[TranscribedWord(text="hi", start=0.0, end=0.3)],
        )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        cookies=_cookies(owner_id),
    ) as client:
        response = await client.get(f"/api/v1/projects/{project.id}/ecs")

        assert response.status_code == 200
        body = response.json()
        assert body["project_id"] == str(project.id)
        assert len(body["segments"]) == 1
        assert body["segments"][0]["words"][0]["text"] == "hi"


async def test_put_ecs_valid_document_roundtrip() -> None:
    project_id, cookies = await _make_transcribed_project()
    seg_id = str(uuid.uuid4())
    w1, w2 = str(uuid.uuid4()), str(uuid.uuid4())

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        response = await client.put(
            f"/api/v1/projects/{project_id}/ecs",
            json={
                "segments": [
                    {
                        "id": seg_id,
                        "words": [
                            {"id": w1, "text": "hello", "start": 0.0, "end": 0.4},
                            {"id": w2, "text": "world", "start": 0.4, "end": 0.9},
                        ],
                    }
                ]
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["segments"][0]["id"] == seg_id
    assert [w["text"] for w in body["segments"][0]["words"]] == ["hello", "world"]

    # Persisted, not just echoed.
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        get_response = await client.get(f"/api/v1/projects/{project_id}/ecs")
    assert get_response.json() == body


async def test_put_ecs_not_found_before_transcription() -> None:
    owner_id = await _make_owner()
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=owner_id,
            name="PUT ecs not-transcribed test",
            video_url="/files/projects/z/source.mp4",
        )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        cookies=_cookies(owner_id),
    ) as client:
        response = await client.put(
            f"/api/v1/projects/{project.id}/ecs", json={"segments": []}
        )

    assert response.status_code == 404


async def _put_and_get_details(
    project_id: uuid.UUID, cookies: dict[str, str], segments: list[dict]
) -> list:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        response = await client.put(
            f"/api/v1/projects/{project_id}/ecs", json={"segments": segments}
        )
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["error"]["code"] == "validation_error"
    return body["error"]["details"]


async def test_put_ecs_rejects_empty_text() -> None:
    project_id, cookies = await _make_transcribed_project()
    details = await _put_and_get_details(
        project_id,
        cookies,
        [
            {
                "id": str(uuid.uuid4()),
                "words": [
                    {"id": str(uuid.uuid4()), "text": "", "start": 0.0, "end": 0.4}
                ],
            }
        ],
    )
    assert any(d["field"].endswith(".text") for d in details)


async def test_put_ecs_rejects_start_not_less_than_end() -> None:
    project_id, cookies = await _make_transcribed_project()
    details = await _put_and_get_details(
        project_id,
        cookies,
        [
            {
                "id": str(uuid.uuid4()),
                "words": [
                    {"id": str(uuid.uuid4()), "text": "hi", "start": 0.5, "end": 0.5}
                ],
            }
        ],
    )
    assert len(details) == 1


async def test_put_ecs_rejects_overlapping_words_in_segment() -> None:
    project_id, cookies = await _make_transcribed_project()
    details = await _put_and_get_details(
        project_id,
        cookies,
        [
            {
                "id": str(uuid.uuid4()),
                "words": [
                    {"id": str(uuid.uuid4()), "text": "a", "start": 0.0, "end": 1.0},
                    {"id": str(uuid.uuid4()), "text": "b", "start": 0.5, "end": 1.5},
                ],
            }
        ],
    )
    assert len(details) == 1


async def test_put_ecs_rejects_overlapping_segments() -> None:
    project_id, cookies = await _make_transcribed_project()
    details = await _put_and_get_details(
        project_id,
        cookies,
        [
            {
                "id": str(uuid.uuid4()),
                "words": [
                    {"id": str(uuid.uuid4()), "text": "a", "start": 0.0, "end": 1.0}
                ],
            },
            {
                "id": str(uuid.uuid4()),
                "words": [
                    {"id": str(uuid.uuid4()), "text": "b", "start": 0.5, "end": 2.0}
                ],
            },
        ],
    )
    assert len(details) == 1


async def test_put_ecs_rejects_empty_segment() -> None:
    project_id, cookies = await _make_transcribed_project()
    details = await _put_and_get_details(
        project_id, cookies, [{"id": str(uuid.uuid4()), "words": []}]
    )
    assert len(details) == 1
    assert "words" not in details[0]["field"]


async def test_put_ecs_rejects_duplicate_word_ids() -> None:
    # Contract §7: ids unique within the document (V9). Without the check
    # this was a DB primary-key IntegrityError - a 500, not a 422.
    project_id, cookies = await _make_transcribed_project()
    dup = str(uuid.uuid4())
    details = await _put_and_get_details(
        project_id,
        cookies,
        [
            {
                "id": str(uuid.uuid4()),
                "words": [
                    {"id": dup, "text": "a", "start": 0.0, "end": 0.4},
                    {"id": dup, "text": "b", "start": 0.4, "end": 0.8},
                ],
            }
        ],
    )
    assert details[0]["field"] == "segments[0].words[1].id"


async def test_put_ecs_rejects_duplicate_segment_ids() -> None:
    project_id, cookies = await _make_transcribed_project()
    dup = str(uuid.uuid4())
    details = await _put_and_get_details(
        project_id,
        cookies,
        [
            {
                "id": dup,
                "words": [
                    {"id": str(uuid.uuid4()), "text": "a", "start": 0.0, "end": 0.4}
                ],
            },
            {
                "id": dup,
                "words": [
                    {"id": str(uuid.uuid4()), "text": "b", "start": 0.5, "end": 0.9}
                ],
            },
        ],
    )
    assert details[0]["field"] == "segments[1].id"


async def test_put_ecs_with_segment_override_roundtrip() -> None:
    project_id, cookies = await _make_transcribed_project()
    seg_id = str(uuid.uuid4())

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        response = await client.put(
            f"/api/v1/projects/{project_id}/ecs",
            json={
                "segments": [
                    {
                        "id": seg_id,
                        "overrides": {"fontSize": 0.05, "color": "#ff0000"},
                        "words": [
                            {
                                "id": str(uuid.uuid4()),
                                "text": "hi",
                                "start": 0.0,
                                "end": 0.4,
                            }
                        ],
                    }
                ]
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["segments"][0]["overrides"] == {
        "fontSize": 0.05,
        "color": "#ff0000",
    }

    # Persisted, not just echoed.
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        get_response = await client.get(f"/api/v1/projects/{project_id}/ecs")
    assert get_response.json() == body


async def test_put_ecs_rejects_segment_override_out_of_bounds() -> None:
    project_id, cookies = await _make_transcribed_project()
    details = await _put_and_get_details(
        project_id,
        cookies,
        [
            {
                "id": str(uuid.uuid4()),
                "overrides": {"verticalPosition": 1.5},
                "words": [
                    {"id": str(uuid.uuid4()), "text": "hi", "start": 0.0, "end": 0.4}
                ],
            }
        ],
    )
    assert details[0]["field"] == "segments[0].overrides.verticalPosition"


async def test_put_ecs_bumps_project_updated_at() -> None:
    """D12: PUT /ecs is one of the two actions sort=updated cares about."""
    project_id, cookies = await _make_transcribed_project()
    async with async_session_factory() as session:
        before = await project_repo.get(session, project_id)
    assert before is not None

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=cookies
    ) as client:
        response = await client.put(
            f"/api/v1/projects/{project_id}/ecs",
            json={
                "segments": [
                    {
                        "id": str(uuid.uuid4()),
                        "words": [
                            {
                                "id": str(uuid.uuid4()),
                                "text": "hi",
                                "start": 0.0,
                                "end": 0.3,
                            }
                        ],
                    }
                ]
            },
        )
    assert response.status_code == 200

    async with async_session_factory() as session:
        after = await project_repo.get(session, project_id)
    assert after is not None
    assert after.updated_at > before.updated_at
