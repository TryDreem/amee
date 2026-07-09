from sqlalchemy import text

from app.db import async_session_factory


async def test_select_1() -> None:
    async with async_session_factory() as session:
        result = await session.execute(text("SELECT 1"))
        assert result.scalar_one() == 1
