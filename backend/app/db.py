import os
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase


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
    return create_async_engine(to_async_url(url or get_database_url()))


engine: AsyncEngine = make_engine()
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


def get_session() -> AsyncSession:
    return async_session_factory()


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency — one session per request, closed when the request ends."""
    async with async_session_factory() as session:
        yield session
