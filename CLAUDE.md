# Amee — Project Memory

Auto-subtitle video editor. Python/FastAPI backend, React/TS frontend, WhisperX for ASR,
ffmpeg/libass for burn-in export.

## Authority order (non-negotiable)

1. `docs/architecture.md` — **binding.** Data model, pipeline, style/layout separation, segmentation.
2. `docs/api-contract.md` — binding for wire shapes. Implements (1); never overrides it.
3. `docs/INVARIANTS.md` — a checklist distilled from (1) and (2). If it disagrees with (1), (1) wins
   and INVARIANTS.md is the bug.
4. Code.

**Never edit (1) or (2).** They are the fixed constraints this repo implements. If a task appears to
require changing them, stop and say so explicitly in your response — do not "reconcile" silently.

If a request contradicts a decision in (1), say which section it contradicts and what it would cost,
then wait. Do not quietly implement the contradiction.

**None of (1)-(3) are `@import`-ed here on purpose.** `@import` loads a file's full text into every
session at launch, unconditionally -- fine for a 150-line file, wasteful for a 400-line contract that
most tasks never touch. Instead, run the `amee-arch-check` skill (triggers automatically on most
architecture-adjacent tasks, or invoke it yourself) -- it points you at `docs/INVARIANTS.md` first,
and at the specific section of (1)/(2) only when that isn't enough. This is *why* CLAUDE.md stays
under 200 lines: the big documents live one hop away, not inline.

## Settled — do not re-open

Preset+delta style model · relative units (fontSize, verticalPosition, safeArea are fractions of
video dimensions) · two Celery queues (`transcribe`, `export`) · explicit user-triggered
Recalculate Groups · segment bounds derived, never stored · center-only horizontal alignment ·
whole-document PUT (no PATCH) · undo/redo is frontend-only.

These were argued through and closed. Do not propose alternatives unless the human explicitly asks
to revisit one.

## Still open — flag, never assume

Listed in `docs/architecture.md` §14 and `docs/api-contract.md` §13. Short list:

- retokenization algorithm for whole-phrase edits
- `Word.id` reuse vs regeneration at retokenization
- UI confirmation before Recalculate Groups
- document versioning / optimistic concurrency (none in MVP; last-write-wins)
- payment/pricing model (quota itself and auth mechanism are resolved — api-contract §13/§15)
- preset+delta **wire shape** (api-contract §8 marks it as inferred, not confirmed)
- upload vs. transcribe as two calls (api-contract §4, flagged)
- export persisting `ecs`+`style` as a side effect (api-contract §12, flagged)

If your task touches one of these, pick nothing. Say "this is open per §N" and ask. A default chosen
by an agent becomes a decision nobody made.

## The invariants you will be tempted to break

Full list: `docs/INVARIANTS.md`. Read it before touching the data model, the splitter, the layout
engine, or any endpoint. The four that get broken most often:

- **Segment has no `start`/`end`.** Not in the DB, not in JSON, not in TS types. Derive from
  `words[0].start` / `words.at(-1).end`.
- **Style changes never mutate ECS.** The Layout Engine reads; it never writes.
- **Recalculate Groups is never automatic.** Not on keystroke, not after a style change, not on save.
- **Nothing re-runs WhisperX after the first pass.** Adding a word gives it a locally-estimated
  timestamp. That is the design, not a shortcut.

## Layers (backend)

```
api/          FastAPI routes. Validation in/out. Zero business logic.
services/     Orchestration. Takes and returns plain serializable data (ids, paths, primitives).
              Never sees a Request object. This is what makes Celery adapters thin.
repositories/ Storage-technology-hiding. PostgreSQL from the MVP (architecture.md §2.1),
              async SQLAlchemy, including inside Celery tasks via asyncio.run().
integrations/ ffmpeg, WhisperX, Celery, storage.py.
```

A route that touches a repository directly is a bug. A service that imports `fastapi` is a bug.

## Frontend rules

- `src/api/types.gen.ts` is **generated** from the backend's `/openapi.json`. Never hand-edit it.
  Run `make types`. If it changes, the backend changed — that is the signal, not an inconvenience.
- Editing state (ECS + CaptionStyleSpec + undo/redo stacks) lives in the frontend. The backend is
  told about it on save/export, never per keystroke.
- Preview renderer must implement exactly the layout rules in architecture.md §8–§10. Any divergence
  from the libass export path is the single biggest correctness risk in this project (§12).

## Commands

```
make dev        # docker compose up + backend + frontend, ports derived from this worktree's slot
make check      # ruff + mypy + pytest + tsc + eslint + vitest  (must pass before any PR)
make types      # regenerate frontend/src/api/types.gen.ts from backend OpenAPI
make migrate    # run Alembic migrations (backend/alembic) — lands in M1, not deferred
scripts/wt-env.sh   # allocate this worktree's port slot, write .env.local
```

CI runs `make check` plus a contract-drift check: it regenerates types and fails if the committed
file differs.

## Parallel work

Multiple Claude Code sessions run against this repo at once, each in its own git worktree, each
owning a disjoint set of directories. See `docs/AGENTS_WORKFLOW.md`.

**Stay inside your assigned paths.** Do not edit shared seams (`docs/`, `Makefile`,
`docker-compose.yml`, `.github/`, lockfiles, `backend/app/schemas/**`, `frontend/src/api/types.gen.ts`)
unless the task explicitly assigns them to you. A `PreToolUse` hook blocks the worst of these; the
rest is on you.

Commit to your worktree branch. Never `git push --force`. Never merge to `main` yourself — open a PR.

## Style

Python: ruff defaults, type hints everywhere, Pydantic v2 for wire models.
TypeScript: strict mode, no `any`, no default exports except React components.
Tests: pytest for backend, vitest for frontend. New endpoint ⇒ new test. New invariant ⇒ new test.

Small, reviewable diffs. If a task grows past ~400 changed lines, stop and split it.

## Talking to the human

Respond in Russian, in plain, direct language -- short sentences, no bureaucratic phrasing, no filler
before the point. Keep identifiers exactly as they appear in code and docs, always in English and
unchanged: variable/function/class/file names, commands, flags, config keys, HTTP methods, section
numbers (§4.2), invariant ids (D5, E3), and anything quoted from architecture.md/api-contract.md.
Don't translate these into Russian and don't transliterate them.

If a technical term has no natural short Russian equivalent (e.g. "worktree", "webhook"), leave it in
English rather than forcing an awkward translation -- clarity over purity.

## Self-check before finishing

Before presenting any code or ending a turn that changed code, re-read your own diff once, specifically for:

- did I touch anything in the "Settled" or "Still open" lists above without flagging it?
- does every changed file still satisfy the invariants in `docs/INVARIANTS.md` that it touches?
- did tests actually get written for what changed, not just left to a future task?
- is there a simpler version of this diff that does the same thing?

If the self-check finds something, fix it before responding -- don't report the problem and leave it
for the next turn. Say briefly what you checked and what (if anything) you changed as a result; don't
narrate the check step by step.