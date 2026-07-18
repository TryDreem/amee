import asyncio
import os
import subprocess
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import asyncpg
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

# Redirect to an isolated database on the same Postgres server *before*
# app.db (imported below, transitively via app.main) creates its
# module-level engine singleton from AMEE_DB_URL. Without this, `pytest`
# writes straight into whatever database AMEE_DB_URL already points at -
# the dev database in local runs (.env.local), permanently, since there's
# no per-test transaction rollback either. CI is unaffected: its Postgres
# service is already a fresh container per run.
_TEST_DB_NAME = "amee_test"
_dev_url_parts = urlsplit(os.environ["AMEE_DB_URL"])
_test_db_url = urlunsplit(_dev_url_parts._replace(path=f"/{_TEST_DB_NAME}"))
os.environ["AMEE_DB_URL"] = _test_db_url


def _create_test_database_if_missing() -> None:
    async def _create() -> None:
        admin_url = urlunsplit(_dev_url_parts._replace(path="/postgres"))
        conn = await asyncpg.connect(admin_url)
        try:
            exists = await conn.fetchval(
                "SELECT 1 FROM pg_database WHERE datname = $1", _TEST_DB_NAME
            )
            if not exists:
                await conn.execute(f'CREATE DATABASE "{_TEST_DB_NAME}"')
        finally:
            await conn.close()

    asyncio.run(_create())


def _migrate_test_database() -> None:
    backend_root = Path(__file__).resolve().parent.parent
    cfg = Config(str(backend_root / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_root / "alembic"))
    command.upgrade(cfg, "head")


_create_test_database_if_missing()
_migrate_test_database()

from app.db import Base, async_session_factory  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


# Seeded once by a data migration (f4ac66039fe6), not test-created data -
# wiping it after every test would just re-trigger "no default preset
# seeded" ValueErrors everywhere, since nothing reseeds it mid-run.
_SEED_TABLES = {"presets"}


@pytest.fixture(autouse=True)
async def _clean_database():
    """Function-scoped, autouse: every test starts with an empty
    `amee_test` database (seed tables excepted). Deletes rather than
    TRUNCATE - simpler ordering (child tables first via `sorted_tables`
    reversed) and fine at test-data volumes."""
    yield
    async with async_session_factory() as session:
        for table in reversed(Base.metadata.sorted_tables):
            if table.name in _SEED_TABLES:
                continue
            await session.execute(table.delete())
        await session.commit()


@pytest.fixture
def sample_video(tmp_path: Path) -> Path:
    """A tiny real mp4, generated on the fly — used by anything that needs
    an actual video on disk (ffmpeg probing, project upload)."""
    path = tmp_path / "sample.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=1:size=320x240:rate=10",
            "-pix_fmt",
            "yuv420p",
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    return path


@pytest.fixture
def tall_sample_video(tmp_path: Path) -> Path:
    """A real mp4 above the 1080p proxy threshold (arch §2.8d) — used by
    tests that need the preview-proxy branch to actually trigger."""
    path = tmp_path / "tall_sample.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=1:size=1920x1440:rate=10",
            "-pix_fmt",
            "yuv420p",
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    return path
