"""scripts/ops/vm2_self_deallocate.py's idle-grace state machine - the periodic check VM#2 runs
on itself (via systemd timer) to decide whether to call Deallocate. Loaded by file path since the
script lives outside the backend/app package (deliberately - see its own module docstring). Only
main()'s branching is exercised here: _has_active_jobs/_deallocate_self/_self_resource_id/
_managed_identity_token each make a real DB or IMDS call and are monkeypatched out, the same way
app/integrations/azure_vm.py's HTTP calls get their own dedicated transport-level tests elsewhere.
"""

import importlib.util
import sys
import time
from pathlib import Path
from types import ModuleType

import pytest

_SCRIPT_PATH = (
    Path(__file__).resolve().parents[2] / "scripts" / "ops" / "vm2_self_deallocate.py"
)


def _load_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("vm2_self_deallocate", _SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def mod(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    module = sys.modules.get("vm2_self_deallocate") or _load_module()
    sys.modules["vm2_self_deallocate"] = module
    monkeypatch.setattr(module, "_STATE_FILE", tmp_path / "last-busy-at")
    monkeypatch.setattr(module, "_IDLE_GRACE_SECONDS", 300)
    return module


async def test_active_jobs_mark_busy_and_never_deallocate(
    mod: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    deallocated = False

    async def fake_has_active_jobs() -> bool:
        return True

    async def fake_deallocate() -> None:
        nonlocal deallocated
        deallocated = True

    monkeypatch.setattr(mod, "_has_active_jobs", fake_has_active_jobs)
    monkeypatch.setattr(mod, "_deallocate_self", fake_deallocate)

    await mod.main()

    assert deallocated is False
    assert mod._STATE_FILE.exists()


async def test_first_ever_run_while_idle_starts_the_grace_period_without_deallocating(
    mod: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No watermark file yet (fresh boot/deploy) - must not deallocate on the very first check."""
    deallocated = False

    async def fake_has_active_jobs() -> bool:
        return False

    async def fake_deallocate() -> None:
        nonlocal deallocated
        deallocated = True

    monkeypatch.setattr(mod, "_has_active_jobs", fake_has_active_jobs)
    monkeypatch.setattr(mod, "_deallocate_self", fake_deallocate)
    assert not mod._STATE_FILE.exists()

    await mod.main()

    assert deallocated is False
    assert mod._STATE_FILE.exists()


async def test_idle_but_within_grace_period_does_not_deallocate(
    mod: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    mod._STATE_FILE.write_text(str(time.time() - 10))  # idle 10s, grace is 300s

    async def fake_has_active_jobs() -> bool:
        return False

    async def fake_deallocate() -> None:
        raise AssertionError("must not be called before the grace period elapses")

    monkeypatch.setattr(mod, "_has_active_jobs", fake_has_active_jobs)
    monkeypatch.setattr(mod, "_deallocate_self", fake_deallocate)

    await mod.main()  # raises via fake_deallocate if this branch is wrong


async def test_idle_past_grace_period_deallocates(
    mod: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    mod._STATE_FILE.write_text(str(time.time() - 301))  # idle 301s, grace is 300s

    async def fake_has_active_jobs() -> bool:
        return False

    deallocated = False

    async def fake_deallocate() -> None:
        nonlocal deallocated
        deallocated = True

    monkeypatch.setattr(mod, "_has_active_jobs", fake_has_active_jobs)
    monkeypatch.setattr(mod, "_deallocate_self", fake_deallocate)

    await mod.main()

    assert deallocated is True


async def test_a_job_appearing_on_the_recheck_cancels_the_deallocate(
    mod: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Past the grace period, but the mandatory recheck (right before the irreversible call) now
    sees an active job - must re-mark busy and skip deallocating, not act on the stale read."""
    mod._STATE_FILE.write_text(str(time.time() - 301))
    calls = 0

    async def fake_has_active_jobs() -> bool:
        nonlocal calls
        calls += 1
        return calls > 1  # idle on the first check, busy on the recheck

    async def fake_deallocate() -> None:
        raise AssertionError("must not deallocate - the recheck found an active job")

    monkeypatch.setattr(mod, "_has_active_jobs", fake_has_active_jobs)
    monkeypatch.setattr(mod, "_deallocate_self", fake_deallocate)

    await mod.main()

    assert calls == 2


def test_self_resource_id_is_built_from_imds_instance_metadata(mod: ModuleType) -> None:
    """The deallocate call targets this VM's own resource, discovered at run time - not a
    hardcoded or configured id, unlike VM#1's AMEE_VM2_RESOURCE_ID (app/integrations/azure_vm.py),
    which points at a *different* VM and genuinely can't be self-discovered the same way."""
    import asyncio

    import httpx

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "compute": {
                    "subscriptionId": "sub-1",
                    "resourceGroupName": "amee-prod",
                    "name": "amee-prod-vm2",
                }
            },
        )

    from unittest.mock import patch

    original_init = httpx.AsyncClient.__init__

    def patched_init(self: httpx.AsyncClient, *args: object, **kwargs: object) -> None:
        kwargs["transport"] = httpx.MockTransport(handler)
        original_init(self, *args, **kwargs)  # type: ignore[arg-type]

    with patch.object(httpx.AsyncClient, "__init__", patched_init):
        resource_id = asyncio.run(mod._self_resource_id())

    assert resource_id == (
        "/subscriptions/sub-1/resourceGroups/amee-prod"
        "/providers/Microsoft.Compute/virtualMachines/amee-prod-vm2"
    )
