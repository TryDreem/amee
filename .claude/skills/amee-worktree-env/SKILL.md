---
name: amee-worktree-env
description: Bring up an isolated dev environment inside a git worktree so parallel Claude Code sessions don't collide on ports, the RabbitMQ broker, the SQLite database, or the storage directory. Use this at the start of every session in a worktree, when `make dev` fails with "address already in use", when Celery jobs land in the wrong worktree's worker, or when two agents appear to be sharing a database.
---

# Isolated dev environment per worktree

Git worktrees isolate **files**. They do not isolate **runtime resources**. Two agents running
`make dev` both bind port 8000, both talk to the same RabbitMQ broker, and both write the same
SQLite file. Files stay clean; the running system does not.

## Every session, first command

```bash
scripts/wt-env.sh
```

This allocates a stable **slot** (0–9) for the current worktree, records it in a registry inside the
shared git directory, and writes `.env.local` with derived ports:

```
base = 8000 + slot*100
API_PORT=base   WEB_PORT=base+1   RABBITMQ_PORT=base+2
RABBITMQ_MGMT_PORT=base+3   REDIS_PORT=base+4
COMPOSE_PROJECT_NAME=amee-<slot>
AMEE_DB_URL=sqlite:///./.data/amee.sqlite
AMEE_STORAGE_DIR=./.data/storage
```

The registry lives at `$(git rev-parse --git-common-dir)/amee-slots`, which every worktree of this
repo shares and no worktree commits. That is what makes slot allocation collision-free without a
lockfile.

Then:

```bash
make dev
```

## Why `.env.local` is not in `.worktreeinclude`

`.worktreeinclude` copies gitignored files into new worktrees. It lists `.env.secrets` and
deliberately **not** `.env.local` — copying `.env.local` would hand every worktree the same ports,
which is exactly the bug this whole mechanism exists to prevent. `.env.local` is generated, per
worktree, by `scripts/wt-env.sh`.

## Database and storage

`AMEE_DB_URL` and `AMEE_STORAGE_DIR` are relative paths under `./.data/`, which is gitignored and
therefore per-worktree by construction. No two agents share a database. This means each worktree
needs its own transcription run before it has an ECS to edit — that is correct and intended, not a
bug to route around by pointing at a shared `.data/`.

## Celery

`COMPOSE_PROJECT_NAME=amee-<slot>` gives each worktree its own RabbitMQ container. The two queues
(`transcribe`, `export`) stay exactly two — do not add a per-worktree queue prefix to a shared broker
as a workaround. Separate brokers, not shared brokers with namespaced queues.

## Cleanup

After a worktree is merged and removed, free its slot:

```bash
git worktree remove .claude/worktrees/<name>
scripts/wt-env.sh --gc
```

`--gc` drops registry rows whose worktree directory no longer exists. Skip it long enough and you run
out of slots at ten.

## Diagnosing

```bash
scripts/wt-env.sh --show    # this worktree's slot and ports
git worktree list           # all worktrees
docker compose ps           # this worktree's containers only (project name is scoped)
```

If a job you enqueued never runs, check that the worker you're watching belongs to *this* worktree's
compose project. Nine times out of ten it doesn't.
