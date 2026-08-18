import uuid
from typing import Any

from sqlalchemy import ColumnElement, func, select, update
from sqlalchemy import delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import ProjectModel
from app.schemas.project import ProjectSort


async def create(
    session: AsyncSession,
    *,
    owner_id: uuid.UUID,
    name: str,
    video_url: str,
    language: str | None = None,
    project_id: uuid.UUID | None = None,
) -> ProjectModel:
    """`project_id` is optional: the column defaults to a fresh uuid4 if
    omitted (used by repository-level tests), but the service layer mints one
    up front — it needs the id before this call, to namespace the uploaded
    file on disk (app/services/projects.py). No video_width/height/duration
    here — POST /projects only saves the file (arch §2.8); those, plus
    thumbnail_url/preview_video_url, are written later by update_media/
    update_preview once the transcribe job's branches finish."""
    project = ProjectModel(
        owner_id=owner_id, name=name, video_url=video_url, language=language
    )
    if project_id is not None:
        project.id = project_id
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return project


async def get(session: AsyncSession, project_id: uuid.UUID) -> ProjectModel | None:
    return await session.get(ProjectModel, project_id)


def _order_by(sort: ProjectSort) -> list[ColumnElement[Any]]:
    """Every ordering ends with `id DESC` as a tie-break. Without it, rows
    sharing the sort key (same `created_at` on a bulk import, same `name`,
    or the whole never-opened tail under `opened`) have no defined order
    between them, and Postgres is free to return them differently per query
    — which under limit/offset shows up as rows repeating on one page and
    vanishing from another (contract §4).

    `updated`/`opened` sort newest-first like `newest` does; for `opened`,
    never-opened projects (`last_opened_at IS NULL`) go last. Postgres puts
    NULLs first under DESC by default, which would rank "never opened" as
    "most recently opened" — exactly backwards.
    """
    tie_break = ProjectModel.id.desc()
    orderings: dict[ProjectSort, list[ColumnElement[Any]]] = {
        ProjectSort.newest: [ProjectModel.created_at.desc()],
        ProjectSort.oldest: [ProjectModel.created_at.asc()],
        ProjectSort.updated: [ProjectModel.updated_at.desc()],
        ProjectSort.opened: [ProjectModel.last_opened_at.desc().nullslast()],
        # lower() so "apple" and "Apple" sort together — Postgres' default
        # collation would otherwise group by case first, which reads as
        # broken alphabetical ordering to a user.
        ProjectSort.az: [func.lower(ProjectModel.name).asc()],
        ProjectSort.za: [func.lower(ProjectModel.name).desc()],
    }
    return [*orderings[sort], tie_break]


async def list_page(
    session: AsyncSession,
    *,
    owner_id: uuid.UUID,
    limit: int,
    offset: int,
    q: str | None = None,
    sort: ProjectSort = ProjectSort.newest,
) -> tuple[list[ProjectModel], int]:
    """Returns one page plus the total number of rows matching `q` (not just
    this page's length — contract §4). Two queries by design: a windowed
    SELECT and a COUNT over the same filter, which is the standard shape and
    keeps `total` honest when `offset` runs past the end.

    `limit`/`offset` are taken as given — clamping them is a business rule
    and lives in the service layer, not here.
    """
    filters = [ProjectModel.owner_id == owner_id]
    if q:
        # ILIKE, not lower(name) LIKE lower(...): Postgres-native, and the
        # escape below keeps a literal % or _ in the user's query from
        # being read as a wildcard.
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        filters.append(ProjectModel.name.ilike(f"%{escaped}%", escape="\\"))

    page = await session.execute(
        select(ProjectModel)
        .where(*filters)
        .order_by(*_order_by(sort))
        .limit(limit)
        .offset(offset)
    )
    total = await session.execute(
        select(func.count()).select_from(ProjectModel).where(*filters)
    )
    return list(page.scalars().all()), total.scalar_one()


async def count_by_owner(session: AsyncSession, owner_id: uuid.UUID) -> int:
    """A live count, not a running counter column — deleting a project frees a quota slot
    immediately, with no separate decrement to keep in sync (services/projects.py's quota check)."""
    result = await session.execute(
        select(func.count())
        .select_from(ProjectModel)
        .where(ProjectModel.owner_id == owner_id)
    )
    return result.scalar_one()


async def update_media(
    session: AsyncSession,
    project_id: uuid.UUID,
    *,
    width: int,
    height: int,
    duration_seconds: float,
    thumbnail_url: str,
) -> ProjectModel:
    """Written by the transcribe job's probe-and-thumbnail branch (arch
    §2.8b-c) once it finishes — not at upload time."""
    project = await session.get(ProjectModel, project_id)
    if project is None:
        raise ValueError(f"project {project_id} not found")
    project.video_width = width
    project.video_height = height
    project.video_duration_seconds = duration_seconds
    project.thumbnail_url = thumbnail_url
    await session.commit()
    await session.refresh(project)
    return project


async def touch_updated_at(session: AsyncSession, project_id: uuid.UUID) -> None:
    """Bumps `Project.updated_at` to now — called only from the `PUT /ecs`
    and `PUT /style` service functions (D12), never from `replace()`/
    `update()` themselves, since those are also called from the smart-split
    and export-persistence paths, which must NOT count as an edit. `UPDATE
    ... SET updated_at = now()` rather than a `session.get` + attribute set:
    no need to load the row into the session just to bump one column, and
    `func.now()` matches how every other timestamp column in this schema is
    stamped (server_default/onupdate), not a Python-side `datetime.now()`."""
    await session.execute(
        update(ProjectModel)
        .where(ProjectModel.id == project_id)
        .values(updated_at=func.now())
    )
    await session.commit()


async def touch_last_opened_at(session: AsyncSession, project_id: uuid.UUID) -> bool:
    """Returns whether the project exists, so the caller (`POST
    /projects/{id}/open`) can 404 without a second query. Fetches first
    (like `update_media`/`update_preview` above) rather than checking
    `CursorResult.rowcount` off a bare `UPDATE` — `AsyncSession.execute`'s
    return type doesn't statically expose it, and this matches the existing
    style in this file."""
    project = await session.get(ProjectModel, project_id)
    if project is None:
        return False
    project.last_opened_at = func.now()
    await session.commit()
    return True


async def update_preview(
    session: AsyncSession, project_id: uuid.UUID, *, preview_video_url: str
) -> ProjectModel:
    """Written by the transcribe job's conditional preview-proxy branch
    (arch §2.8d) — `preview_video_url` is either the proxy's own URL or, if
    no proxy was needed, the same value as `video_url`."""
    project = await session.get(ProjectModel, project_id)
    if project is None:
        raise ValueError(f"project {project_id} not found")
    project.preview_video_url = preview_video_url
    await session.commit()
    await session.refresh(project)
    return project


async def delete(session: AsyncSession, project_id: uuid.UUID) -> None:
    """`DELETE /projects/{id}` (contract §4, X8) - hard delete, no trash. The
    caller (`services/projects.py::delete_project`) must delete every child
    row (jobs, ecs segments/words, style, raw transcript) first - none of
    those foreign keys are `ON DELETE CASCADE`, so this alone would raise a
    foreign key violation if anything still references this project."""
    await session.execute(sa_delete(ProjectModel).where(ProjectModel.id == project_id))
    await session.commit()


async def reassign_owner(
    session: AsyncSession, *, from_owner_id: uuid.UUID, to_owner_id: uuid.UUID
) -> None:
    """Moves every project from one owner to another.

    Used when a guest signs in with Google (app/services/auth.py): their existing work has to
    follow them onto the real account rather than being stranded under a guest id nothing can
    reach again. Four sibling tables carry `owner_id` too and each has its own copy of this -
    the service calls all five, since a project whose segments still point at the old owner is
    a worse state than either endpoint.
    """
    await session.execute(
        update(ProjectModel)
        .where(ProjectModel.owner_id == from_owner_id)
        .values(owner_id=to_owner_id)
    )
    await session.commit()
