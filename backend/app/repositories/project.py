import uuid
from typing import Any

from sqlalchemy import ColumnElement, func, select
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
    filters = []
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
