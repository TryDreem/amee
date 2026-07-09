---
name: amee-worktree-env
description: Bring up an isolated dev environment inside a git worktree so parallel Claude Code sessions don't collide on ports, the RabbitMQ broker, the Postgres database, or the storage directory. Use this at the start of every session in a worktree, when `make dev` fails with "address already in use", when Celery jobs land in the wrong worktree's worker, or when two agents appear to be sharing a database.
---

# Isolated dev environment per worktree

Git worktrees isolate **files**. They do not isolate **runtime resources**. Two agents running
`make dev` both bind port 8000, both talk to the same RabbitMQ broker, and both write to the same
Postgres database. Files stay clean; the running system does not.

## Every session, first command

```bash
scripts/wt-env.sh
```

This allocates a stable **slot** (0–9) for the current worktree, records it in a registry inside the
shared git directory, and writes `.env.local` with derived ports:

```
base = 8000 + slot*100
API_PORT=base   WEB_PORT=base+1   RABBITMQ_PORT=base+2
RABBITMQ_MGMT_PORT=base+3   REDIS_PORT=base+4   POSTGRES_PORT=base+5
COMPOSE_PROJECT_NAME=amee-<slot>
AMEE_DB_URL=postgresql://amee:amee@localhost:POSTGRES_PORT/amee
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

`AMEE_STORAGE_DIR` is a relative path under `./.data/`, which is gitignored and therefore
per-worktree by construction. `AMEE_DB_URL` isolates the same way `RABBITMQ_PORT` does instead of
by path: each worktree gets its own Postgres container (`COMPOSE_PROJECT_NAME=amee-<slot>`) on its
own `POSTGRES_PORT`. No two agents share a database or its container. This means each worktree needs
its own `make migrate` and its own transcription run before it has an ECS to edit — that is correct
and intended, not a bug to route around by pointing at a shared Postgres.

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
