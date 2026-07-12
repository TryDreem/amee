import os
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool


class Base(DeclarativeBase):
    pass


def to_async_url(url: str) -> str:
    """AMEE_DB_URL is driver-agnostic (scripts/wt-env.sh writes a plain
    postgresql:// DSN, usable by psql/sync tooling too) — the app picks the
    async driver here rather than baking it into the shared env var."""
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


def get_database_url() -> str:
    return os.environ["AMEE_DB_URL"]


def make_engine(url: str | None = None) -> AsyncEngine:
    """NullPool, not the default pool: this engine is a module-level
    singleton shared by both the FastAPI app (one long-lived event loop) and
    Celery tasks (a fresh loop per task, via asyncio.run() — arch §2.2). A
    pooled asyncpg connection is bound to the loop it was opened on; reused
    from a later, different loop it raises "another operation is in
    progress". NullPool opens a fresh physical connection per checkout, so
    there's never a stale one left over from a loop that already closed."""
    return create_async_engine(
        to_async_url(url or get_database_url()), poolclass=NullPool
    )


engine: AsyncEngine = make_engine()
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


def get_session() -> AsyncSession:
    return async_session_factory()


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency — one session per request, closed when the request ends."""
    async with async_session_factory() as session:
        yield session
