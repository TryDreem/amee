import uuid
from datetime import UTC, datetime, timedelta

import httpx
from httpx import ASGITransport

from app.db import async_session_factory
from app.integrations.session_cookie import sign_user_id
from app.main import app
from app.repositories import project as project_repo
from app.repositories import user as user_repo
from app.services.projects import DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT

_BASE = datetime(2026, 1, 1, tzinfo=UTC)


async def _make_owner() -> uuid.UUID:
    """A real row, not a bare uuid4() - get_current_user_id falls back to minting a fresh guest
    whenever the cookie's id doesn't resolve to an existing user, so _list()'s cookie would be
    silently ignored (and every test would see an empty page) without this."""
    async with async_session_factory() as session:
        user = await user_repo.create_guest(session)
    return user.id


async def _seed(
    owner_id: uuid.UUID,
    name: str,
    *,
    created_offset: int = 0,
    updated_offset: int | None = None,
    opened_offset: int | None = None,
) -> str:
    """Timestamps are written explicitly rather than relying on insertion
    order: `server_default=now()` lands rows microseconds apart, which would
    make every ordering assertion below depend on how fast the test ran.
    `updated_offset` defaults to `created_offset` — a project nobody edited
    reads as "last updated at upload time"."""
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=owner_id,
            name=name,
            video_url="/files/projects/seed/source.mp4",
        )
        project_id = str(project.id)
        project.created_at = _BASE + timedelta(days=created_offset)
        project.updated_at = _BASE + timedelta(
            days=created_offset if updated_offset is None else updated_offset
        )
        project.last_opened_at = (
            None if opened_offset is None else _BASE + timedelta(days=opened_offset)
        )
        await session.commit()
    return project_id


async def _list(owner_id: uuid.UUID, **params: object) -> dict[str, object]:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        cookies={"amee_session": sign_user_id(owner_id)},
    ) as client:
        response = await client.get("/api/v1/projects", params=params)  # type: ignore[arg-type]
    assert response.status_code == 200
    return dict(response.json())


def _ids(page: dict[str, object]) -> list[str]:
    items: list[dict[str, str]] = page["items"]  # type: ignore[assignment]
    return [item["id"] for item in items]


def _names(page: dict[str, object]) -> list[str]:
    items: list[dict[str, str]] = page["items"]  # type: ignore[assignment]
    return [item["name"] for item in items]


async def test_default_page_size_and_total_counts_everything() -> None:
    owner = await _make_owner()
    for i in range(DEFAULT_PAGE_LIMIT + 3):
        await _seed(owner, f"Project {i:02d}", created_offset=i)

    page = await _list(owner)

    assert len(page["items"]) == DEFAULT_PAGE_LIMIT  # type: ignore[arg-type]
    # `total` is the whole matching set, not this page's length - the UI
    # renders "page X of Y" from it (contract §4).
    assert page["total"] == DEFAULT_PAGE_LIMIT + 3


async def test_listing_is_scoped_to_the_calling_user() -> None:
    """The point of the whole owner_id split - one user's projects must never show up in
    another's list, even though both hit the same endpoint."""
    mine = await _make_owner()
    someone_elses = await _make_owner()
    await _seed(mine, "Mine")
    await _seed(someone_elses, "Not mine")

    page = await _list(mine)

    assert _names(page) == ["Mine"]
    assert page["total"] == 1


async def test_offset_walks_the_full_set_without_gaps_or_repeats() -> None:
    owner = await _make_owner()
    for i in range(7):
        await _seed(owner, f"Walk {i}", created_offset=i)

    seen = (
        _ids(await _list(owner, limit=3, offset=0))
        + _ids(await _list(owner, limit=3, offset=3))
        + _ids(await _list(owner, limit=3, offset=6))
    )

    assert len(seen) == 7
    assert len(set(seen)) == 7


async def test_out_of_range_limit_and_offset_clamp_instead_of_rejecting() -> None:
    """Contract §4: an out-of-range page size is clamped, never a 422 - a
    client bug shouldn't cost the user an error screen, and the cap is what
    stops `limit=999999` from turning this back into "fetch everything"."""
    owner = await _make_owner()
    for i in range(3):
        await _seed(owner, f"Clamp {i}", created_offset=i)

    assert len(_ids(await _list(owner, limit=10_000))) <= MAX_PAGE_LIMIT
    assert len(_ids(await _list(owner, limit=0))) == 1
    assert len(_ids(await _list(owner, limit=-5))) == 1
    assert len(_ids(await _list(owner, offset=-5))) == 3


async def test_search_is_case_insensitive_and_narrows_total() -> None:
    owner = await _make_owner()
    await _seed(owner, "Vacation in Rome")
    await _seed(owner, "VACATION highlights")
    await _seed(owner, "Unrelated clip")

    page = await _list(owner, q="vacation")

    assert page["total"] == 2
    assert set(_names(page)) == {"Vacation in Rome", "VACATION highlights"}


async def test_search_treats_sql_wildcards_as_literal_text() -> None:
    """`%` and `_` are ILIKE wildcards. Unescaped, a user typing "%" would
    match every project instead of the one whose name contains a percent
    sign."""
    owner = await _make_owner()
    await _seed(owner, "100% done")
    await _seed(owner, "nothing special")

    assert (await _list(owner, q="%"))["total"] == 1
    assert (await _list(owner, q="_"))["total"] == 0


async def test_sort_newest_and_oldest_are_opposites() -> None:
    owner = await _make_owner()
    old = await _seed(owner, "Old", created_offset=0)
    new = await _seed(owner, "New", created_offset=5)

    assert _ids(await _list(owner, sort="newest")) == [new, old]
    assert _ids(await _list(owner, sort="oldest")) == [old, new]


async def test_alphabetical_sort_ignores_case() -> None:
    """Postgres' default collation groups uppercase ahead of lowercase, so
    a plain `ORDER BY name` puts "Apple, Zebra, banana" — which reads as
    broken alphabetical ordering. Names are lowered before comparing."""
    owner = await _make_owner()
    await _seed(owner, "banana")
    await _seed(owner, "Apple")
    await _seed(owner, "cherry")

    assert _names(await _list(owner, sort="az")) == ["Apple", "banana", "cherry"]
    assert _names(await _list(owner, sort="za")) == ["cherry", "banana", "Apple"]


async def test_sort_opened_puts_never_opened_projects_last() -> None:
    """Postgres orders NULLs first under DESC by default, which would rank a
    never-opened project as the most recently opened one."""
    owner = await _make_owner()
    never = await _seed(owner, "Never opened")
    recent = await _seed(owner, "Opened recently", opened_offset=9)
    older = await _seed(owner, "Opened a while ago", opened_offset=2)

    assert _ids(await _list(owner, sort="opened")) == [recent, older, never]


async def test_sort_updated_is_independent_of_upload_order() -> None:
    owner = await _make_owner()
    edited_late = await _seed(
        owner, "Uploaded first", created_offset=0, updated_offset=9
    )
    edited_early = await _seed(
        owner, "Uploaded later", created_offset=5, updated_offset=6
    )

    assert _ids(await _list(owner, sort="newest")) == [edited_early, edited_late]
    assert _ids(await _list(owner, sort="updated")) == [edited_late, edited_early]


async def test_pagination_stays_stable_when_the_sort_key_ties() -> None:
    """Every row shares one `created_at`. Without the `id` tie-break the
    order between them is undefined, and Postgres may answer two queries
    differently — which under limit/offset shows up as a row appearing on
    two pages while another never appears at all."""
    owner = await _make_owner()
    for i in range(6):
        await _seed(owner, f"Tie {i}", created_offset=0)

    seen = (
        _ids(await _list(owner, limit=2, offset=0))
        + _ids(await _list(owner, limit=2, offset=2))
        + _ids(await _list(owner, limit=2, offset=4))
    )

    assert len(set(seen)) == 6


async def test_unknown_sort_value_is_rejected() -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/v1/projects", params={"sort": "sideways"})

    # Unlike limit/offset, `sort` has no meaningful clamp — an unknown
    # ordering is a real client bug, so FastAPI's enum validation rejects it.
    assert response.status_code == 422
