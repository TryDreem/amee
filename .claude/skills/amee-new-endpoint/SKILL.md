---
name: amee-new-endpoint
description: The playbook for adding or changing an API endpoint in Amee — the four-layer walk (route → service → repository → integration), the exact wire-format rules, what to validate, what to test, and how to regenerate the frontend types. Use this whenever you add, modify, or debug any FastAPI route, Pydantic wire model, Celery job, or anything under backend/app/api or backend/app/services.
---

# Adding an endpoint in Amee

Every endpoint in the MVP is already specified in `docs/api-contract.md` §3–§12. You are implementing
a specification, not designing one. If the endpoint you need is not in that document, stop: adding an
endpoint is a contract change, and contract changes are a human decision.

## 1. Check first

Run the `amee-arch-check` skill. Specifically confirm you are not about to:

- add `start`/`end` to `Segment` (D5)
- add `id` to raw-transcript words (D2)
- add `transcription_status` to `Project` (P6 — status lives on `Job`, in the app DB)
- add `horizontalAlign` to `CaptionStyleSpec` (L5)
- add a `PATCH` route (D8 — whole-document `PUT` only)
- make the backend persist something that `/recalculate-groups` or `/reset-to-raw` returns (E6)

## 2. The layer walk

```
api/          route: parse, validate, delegate, serialize. Zero business logic.
services/     orchestration. Plain serializable args and returns (ids, paths, primitives).
              No fastapi import. No Request object. Ever.
repositories/ persistence. Hides Postgres. The service must not know what a table is.
integrations/ ffmpeg, WhisperX, Celery, storage.py.
```

Write the service function first, then the route that calls it. If the route reaches a repository
directly, you skipped a layer. If the service imports `fastapi`, the same function can no longer be
called from a Celery task — which is the entire reason the layer exists (arch §2.2, §2.3).

Anything expensive gets a `Job` and a queue. There are exactly two queues: `transcribe`, `export`
(P5). Job status is written by the worker into the app database, never read from Celery's result
backend (P6).

## 3. Wire format

Casing (contract §1) — this catches people every time:

| Group | Style | Examples |
|---|---|---|
| identity / infrastructure | `snake_case` | `id`, `owner_id`, `project_id`, `created_at`, `video_url` |
| `CaptionStyleSpec` | `camelCase` | `presetId`, `fontSize`, `revealMode`, `verticalPosition`, `safeArea` |
| `Word` / `Segment` content | bare lowercase | `id`, `text`, `start`, `end` |

- ids are UUIDv4 strings. The frontend mints `Word`/`Segment` ids locally — that is why they can't be
  sequential integers (contract §1).
- `start`/`end` are float seconds from video start, not ISO timestamps.
- errors use the `{"error": {"code", "message", "details": [{"field", "issue"}]}}` envelope.
- `owner_id` and `project_id` come from the URL/session, never from a request body.

## 4. Validation on `PUT /ecs`

Exactly these, and nothing more (V1–V5):

```
non-empty text · start < end · words non-overlapping and ordered (prev.end <= next.start)
segments non-overlapping · every segment has >= 1 word
```

No minimum word duration (V6 — renderer concern). No `version` check (V7 — last-write-wins).
Failures return `422` with populated `error.details`.

## 5. Polymorphic responses

`/recalculate-groups` and `/reset-to-raw` return `200 {segments}` with the MVP splitter, and
`202 {job}` if an expensive splitter strategy is ever swapped in. Both branches go in the response
model now, even though the `202` path is unreachable today. That is the point: swapping the splitter
must not be a breaking API change (contract §10).

Neither endpoint persists. Neither touches the undo stack. The frontend adopts the returned segments
and pushes one history entry (E6, arch §11).

## 6. Tests

Every endpoint gets, at minimum:

- happy path, response shape asserted field by field
- each documented error code (`404`, `409`, `422` as applicable)
- for `PUT /ecs`: one test per validation rule V1–V5, each failing for its own reason
- for `POST /transcribe`: the 409 guard, plus the "retry after `failed` is allowed" case (P2)

Every invariant you rely on should be a test that fails if someone removes it. `docs/INVARIANTS.md` is
a good source of test names.

## 7. Regenerate the types

```bash
make types
```

`frontend/src/api/types.gen.ts` is generated from `/openapi.json`. Never hand-edit it — a hook blocks
it. CI regenerates it and fails if the committed file differs, so a backend change that alters the
schema *will* be caught. Backend PRs merge before frontend PRs when the schema moves.
