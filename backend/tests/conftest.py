import asyncio
import os
import subprocess
import tempfile
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import asyncpg
import pytest
from alembic.config import Config
from fastapi.testclient import TestClient

from alembic import command

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

# Same problem as AMEE_DB_URL above, for uploaded files instead of DB rows:
# app.integrations.storage.storage_dir() reads this env var fresh on every
# call (no import-time caching to race), but tests that call
# storage.save_video/video_export_paths/etc. would otherwise write real
# files straight into .env.local's dev storage dir forever - nothing ever
# deletes them, since _clean_database (below) only touches Postgres. A
# fresh OS temp dir per test-session keeps this from accumulating in the
# repo at all, unlike the previous state where it silently grew to 700+
# orphaned project directories over the life of this repo.
os.environ["AMEE_STORAGE_DIR"] = tempfile.mkdtemp(prefix="amee-test-storage-")

# Same isolation concern, for Redis - a different DB index (not a different
# server) so a test run's progress-key writes/deletes never collide with
# whatever a locally-running dev Celery worker is reading/writing via
# .env.local's own AMEE_REDIS_URL. Optional: app.integrations.redis
# degrades to a no-op everywhere (A3), so a test environment that never set
# this at all is exercising that exact path, not broken.
if "AMEE_REDIS_URL" in os.environ:
    _redis_url_parts = urlsplit(os.environ["AMEE_REDIS_URL"])
    os.environ["AMEE_REDIS_URL"] = urlunsplit(_redis_url_parts._replace(path="/15"))

# app.integrations.session_cookie signs session cookies against this — it's read fresh on every
# call (no import-time caching), unlike AMEE_DB_URL/AMEE_STORAGE_DIR above, so setdefault is
# enough here: a real value in .env.secrets is used if present, a fixed test value otherwise.
# Not a real secret leaking anywhere - this only has to be *some* consistent value so signatures
# verify within one test run.
os.environ.setdefault("AMEE_SESSION_SECRET", "test-session-secret-not-for-production")


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

from redis import asyncio as _redis_lib

from app.db import Base, async_session_factory
from app.integrations.redis import redis_client
from app.main import app


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
    # Same isolation concern as AMEE_REDIS_URL's DB-15 redirect above, one level further: without
    # this, rate-limit counters (app/integrations/rate_limit.py) accumulate across every test that
    # hits a limited route, since httpx's ASGITransport gives every request the same fake client
    # IP. A handful of tests each doing a couple of uploads would silently exhaust the whole
    # suite's shared per-IP budget partway through an unrelated test.
    if "AMEE_REDIS_URL" in os.environ:
        try:
            async with redis_client() as conn:
                await conn.flushdb()
        except (KeyError, _redis_lib.RedisError):
            pass


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
def hdr_sample_video(tmp_path: Path) -> Path:
    """A real mp4 tagged with PQ/BT.2020 color metadata (`setparams` - a
    plain `-color_trc`/`-color_primaries`/`-colorspace` CLI flag combo
    doesn't reliably make it into the muxed file via libx264) - used to
    exercise the HDR tonemap path in extract_thumbnail end to end, distinct
    from test_is_hdr's pure-dict unit tests for the detection logic itself."""
    path = tmp_path / "hdr_sample.mp4"
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
            "-vf",
            "setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc",
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
