# Amee

Amee is an auto-subtitle video editor for short-form video. Upload a clip, get word-level
transcription back, and edit both the caption *content* (text, timing, grouping) and the caption
*style* (font, color, position, reveal animation) in a live preview — then export a version with
captions burned in, or pull a plain SRT file for use elsewhere.

It's built in the style popularized by Submagic/CapCut: short phrases synced to speech, with the
currently-spoken word highlighted as it's said.

This document is the map of the repository — what it does, how the pieces fit together, and *why*
a number of things are built the way they are. The full, binding technical specification lives in
[`docs/`](#further-reading); this file is the readable entry point into it.

---

## Table of contents

- [What it does](#what-it-does)
- [How a video moves through the system](#how-a-video-moves-through-the-system)
- [Architecture at a glance](#architecture-at-a-glance)
- [The data model, in brief](#the-data-model-in-brief)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [API surface](#api-surface)
- [Running it locally](#running-it-locally)
- [Quality gates](#quality-gates)
- [Key decisions & tradeoffs](#key-decisions--tradeoffs)
- [Known limitations & open questions](#known-limitations--open-questions)
- [Further reading](#further-reading)

---

## What it does

1. **Upload** a video (`.mp4`/`.mov`, H.264/HEVC, up to 4K, up to 2GB).
2. **Transcribe** it — WhisperX produces a word-level transcript (every word gets its own start/end
   timestamp, not just a sentence-level guess), and the words are grouped into readable caption
   phrases automatically.
3. **Edit** — in the browser, adjust wording, timing, and grouping, and separately adjust the visual
   style: font, size, color, highlight colors, outline/shadow/glow, reveal mode (whole phrase vs.
   word-by-word vs. single active word), entrance animation, vertical position, and punctuation
   display. Everything updates in a live preview instantly, with no server round-trip per keystroke
   or slider drag.
4. **Export** — burn the captions into the video, or generate a standalone SRT file, independently
   of each other. The burn-in is rendered by the same component that draws the live preview (see
   [Key decisions](#preview-and-export-are-the-same-renderer-so-parity-is-structural-not-engineered)
   below), so what you see while editing is what ends up in the file.

The whole thing is designed to feel instant to edit and only ever touch the network for the
expensive steps: transcription and the final render.

---

## How a video moves through the system

```
Video
  |
  v
WhisperX  ──────────────────────────  runs exactly once per video, ever
  |
  v
Raw Transcript  ────────────────────  words + timestamps, immutable from here on
  |
  v
Initial Splitter  ──────────────────  fast, local heuristic groups words into phrases
  |
  v
Edited Caption Structure (ECS)  ────  becomes the user's own document
  |
  v
Editor (browser)
  |
  +───────────────────────+
  |                        |
  v                        v
Style changes          Content changes
  |                        |
  v                        v
Layout Engine           Words[] updated
recalculates             (no re-transcription, ever)
preview only                |
                             v
                     Recalculate Groups
                     (explicit, optional,
                      never automatic)
```

The single most important rule in the whole system: **WhisperX runs exactly once.** Every edit after
that — adding a word, retiming a boundary, splitting a phrase, correcting a typo — operates on data
that already exists locally. Nothing in the editor ever triggers a second transcription pass, because
transcription is the one genuinely expensive, non-deterministic step; everything downstream of it is
cheap, local, and safe to re-run as often as the user wants.

A second rule sits right next to it: **style changes and content changes are handled by two entirely
different mechanisms**, and neither one is allowed to trigger the other automatically. Moving a font
slider never touches the caption text or grouping. Adding a word never recalculates layout beyond what
naturally re-renders. This separation is discussed at length below — it's arguably the central design
decision of the whole project.

---

## Architecture at a glance

**Backend** is a four-layer FastAPI app, each layer with one job and a hard boundary to the next:

```
api/            FastAPI routes — request/response validation only, zero business logic
services/       Orchestration — plain serializable data in and out, callable from HTTP or Celery alike
repositories/   Storage-technology-hiding — async SQLAlchemy / PostgreSQL today
integrations/   External tools — ffmpeg, WhisperX, headless Chromium (Playwright), Celery, Redis, disk storage
```

A route that reaches into a repository directly, or a service that imports FastAPI, is a bug by
construction — the layering exists specifically so a background worker can call the exact same
service functions an HTTP handler calls, with no adapter beyond a thin `asyncio.run()` wrapper.

**Background processing** runs on Celery, backed by RabbitMQ, on two queues split by load profile:

- `transcribe` — WhisperX, the initial word→phrase grouping, video probing, thumbnail extraction,
  and (conditionally) a downscaled preview proxy, all running concurrently inside one job.
- `export` — burning captions into the final video, and generating a standalone SRT file.

Job status (`queued` / `processing` / `done` / `failed` / `cancelled`) lives in the application's own
Postgres database, never in Celery's own result backend — there is exactly one place a client needs
to look to know what's happening.

**Frontend** is React + TypeScript, driving a live CSS/Canvas preview directly over the `<video>`
element. Editing state — including the entire undo/redo history — lives in the browser; the backend
only hears about it when the user explicitly saves or exports.

**Redis** is present, but deliberately never a source of truth for anything — it's used for export
progress percentage and the tracked ffmpeg process id (for cancellation), and if it's ever
unreachable, the system degrades to "no progress shown," never to a stuck or wrong job.

---

## The data model, in brief

Two documents matter, and they have very different lifecycles:

- **Raw Transcript** — WhisperX's direct output. Write-once, immutable, forever. Its only purpose is
  to be the fallback for a full project reset ("start over from what was actually said").
- **Edited Caption Structure (ECS)** — a copy of the transcript, regrouped into phrases, that becomes
  the user's own mutable document the moment it's created. From here on it is never reconciled with
  the Raw Transcript automatically; the two are allowed to diverge completely.

The ECS is a strict containment tree — `segments → words`, not two parallel lists that happen to
reference each other:

```
ECS
 └─ Segment[]                  (ordered phrase groups; id is stable, never a positional index)
     ├─ overrides               (optional per-phrase style override — see below)
     └─ Word[]                  (ordered; id, text, start, end — all absolute seconds from video 0)
```

A few things about this shape are worth calling out because they're not the obvious way to build it:

- **A segment has no stored `start`/`end`.** They're always derived — `words[0].start` and
  `words.at(-1).end` — computed the same way by every consumer, so there's no second field that can
  drift out of sync with the words it's supposedly describing.
- **Which words belong to which segment is authored data, not a computed projection.** It's decided
  once by the splitter and then belongs to the user exactly like the word text does — nothing
  silently regroups it as a side effect of some other change (most importantly: never as a side
  effect of a style change).
- **Style lives in a separate document (`CaptionStyleSpec`) entirely.** A segment can carry one
  optional style *override* — the one deliberate, narrow exception to "data never carries style" —
  but the two documents are otherwise fully independent and are read/written through separate
  endpoints.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Python 3.12, FastAPI, Pydantic v2 | ML tooling (WhisperX, ffmpeg orchestration) is native to this ecosystem |
| Database | PostgreSQL, async SQLAlchemy 2.0, Alembic | Chosen over SQLite from day one — see [tradeoffs](#postgres-from-day-one-not-sqlite) below |
| Task queue | Celery + RabbitMQ | Two queues, split by load profile (ML inference vs. video encoding) |
| Cache/ephemeral state | Redis | Never a source of truth — see [tradeoffs](#redis-is-never-a-source-of-truth) below |
| ASR | WhisperX | Word-level timestamps, not just sentence-level |
| Rendering | Headless Chromium (Playwright) + ffmpeg | Burn-in renders the frontend's own caption component, headless — see [tradeoffs](#preview-and-export-are-the-same-renderer-so-parity-is-structural-not-engineered) below |
| Frontend | React 18, TypeScript (strict), Vite | Live client-side preview, no per-keystroke backend calls |
| Frontend testing | Vitest, Testing Library, MSW | Mocked backend for component/integration tests |

---

## Repository layout

```
backend/
  app/
    api/            FastAPI routes (v1)
    services/       Business logic / orchestration
    repositories/   Data access (Postgres via SQLAlchemy)
    integrations/   ffmpeg, WhisperX, browser_render.py (headless Chromium driver), Celery, Redis, disk storage
    models/         SQLAlchemy ORM models
    schemas/        Pydantic wire models
    workers/        Celery app + task definitions
  alembic/          Migrations
  tests/

frontend/
  render.html        Second Vite entry point: the headless render surface export drives (below)
  src/
    render.tsx        Renders CaptionOverlay standalone for browser_render.py to screenshot — no
                       router, no API calls, nothing else the editor page needs
    api/            Backend client + generated types (types.gen.ts is generated, never hand-edited)
    components/     UI components (CaptionOverlay is the shared preview/export renderer, see below)
    pages/          Route-level views
    contexts/       Cross-page state (e.g. export progress)
    hooks/          Shared React hooks
    mocks/          MSW handlers for tests / offline dev

docs/
  architecture.md      Binding architecture spec — the source of truth for the data model and pipeline
  api-contract.md      Binding wire-format spec — implements architecture.md, never overrides it
  INVARIANTS.md        Checklist distilled from the two docs above, for fast reference
  AGENTS_WORKFLOW.md   How multiple people/agents work on this repo in parallel without colliding
```

---

## API surface

Base path: `/api/v1`. Every id is a UUIDv4, mintable by the frontend without a server round trip —
this matters because content edits happen entirely client-side until save, so the frontend needs to
be able to create new word/segment ids on its own with zero collision risk.

| Resource | Endpoints |
|---|---|
| Projects | `POST /projects` · `GET /projects` · `GET /projects/{id}` · `DELETE /projects/{id}` · `POST /projects/{id}/open`¹ |
| Transcription | `POST /projects/{id}/transcribe` |
| Jobs | `GET /jobs/{id}` · `POST /projects/{id}/jobs/{job_id}/cancel` |
| Raw Transcript | `GET /projects/{id}/raw-transcript` *(read-only, forever)* |
| Caption content | `GET`/`PUT /projects/{id}/ecs` |
| Caption style | `GET`/`PUT /projects/{id}/style` |
| Presets | `GET /presets` |
| Recalculate Groups | `POST /projects/{id}/recalculate-groups`² |
| Reset to Raw | `POST /projects/{id}/reset-to-raw`² |
| Export | `POST /projects/{id}/export` (video, persists) · `POST /projects/{id}/export-srt` (SRT only, doesn't persist) |

`GET`/`PUT` pairs are always whole-document operations — no `PATCH` anywhere, deliberately (see
below). The full wire-level spec, including every field, every validation rule, and every status
code, is [`docs/api-contract.md`](docs/api-contract.md).

¹ Implemented and tested on the backend; the frontend has a typed client wrapper (`openProject()`)
but nothing in the UI calls it yet — no page marks a project "opened" today.
² Implemented and tested on the backend; there is currently **no button, menu item, or any other
UI control** that calls either endpoint. See [Known limitations](#known-limitations--open-questions).

---

## Running it locally

```bash
scripts/wt-env.sh   # allocates local ports, writes .env.local (safe to re-run)
make dev            # docker compose up (Postgres/RabbitMQ/Redis) + backend + frontend
```

Other useful targets:

```bash
make check          # ruff + mypy + pytest (backend), tsc + eslint + vitest (frontend) — must pass before any PR
make types           # regenerate frontend/src/api/types.gen.ts from the backend's live OpenAPI schema
make migrate          # run Alembic migrations
```

If `frontend/src/api/types.gen.ts` changes after `make types`, that's the backend's wire shape
changing — not an inconvenience to work around, but the signal to review.

---

## Quality gates

CI runs `make check` against a real Postgres, RabbitMQ, and Redis (services, not mocks) on every
push and pull request, plus a contract-drift check that regenerates the frontend types and fails the
build if the committed file doesn't match. Ruff, mypy (strict mode on the backend), ESLint, and
TypeScript's own compiler all gate merges alongside the test suites.

---

## Key decisions & tradeoffs

This is the part worth reading slowly. Amee has two binding specification documents
(`docs/architecture.md`, `docs/api-contract.md`) that were argued through in detail before most code
was written, specifically so that decisions like these would be made once, deliberately, with the
reasoning captured — instead of being improvised differently by whoever touches that part of the
code next. What follows is a tour of the ones that shaped the system the most.

### Style, Layout, and Data are three separate concerns, and no layer reaches into another's job

This is the governing principle of the whole editor:

> Data says what to show and when. Style says how to show it. Layout decides where to place it.

Concretely: a font-size change never touches which words exist or how they're grouped — it only
triggers a Layout Engine recalculation. Adding a word never touches style. And critically, the Layout
Engine — the thing that decides line wrapping, safe-area placement, and whether text fits — only
*reads* the other two documents; it never mutates either one, and it can't produce data, only a
rendering or a "this doesn't fit" signal. This single rule is what makes the rest of the editing model
predictable: an engineer (or an AI agent) touching a style feature can reason about it without
auditing whether it might silently corrupt caption content, and vice versa.

The one deliberate exception is a per-segment style override — a single phrase can carry its own
style delta, addressed by the segment's own stable id (never by array position, since positions shift
on split/merge/delete). It's carved out explicitly as *the* one exception, not a precedent for
scattering style fields elsewhere in the data model.

### Segment boundaries are derived, never stored

A caption segment has no `start`/`end` field anywhere — not in the database, not on the wire, not in
the TypeScript types. It's always computed from its words: `words[0].start` to `words.at(-1).end`.
The alternative — storing it redundantly for convenience — was rejected because it creates a second
value that has to be kept in sync every time a word is added, removed, or retimed, and that kind of
sync inevitably drifts. The rule generalizes: anything derivable from lower-level data is derived,
never cached as a second source of truth. *Which* words belong to which segment, by contrast, is
authored data — that distinction (derive positions, but never derive membership) is easy to get
backwards and is worth sitting with.

### Recalculate Groups is powerful, and therefore never automatic

Editing text can leave the current phrase grouping stale — a segment that used to be a clean sentence
might now run long after an edit. The system does *not* re-group automatically, not even on save, not
even after a style change. Regrouping is a single explicit user action that fully replaces the
segment list (and wipes any per-segment style overrides in the process, since the splitter never sees
style and therefore can't preserve or reconstruct overrides it never knew existed). The reasoning:
automatic regrouping would silently discard manual split/merge decisions the user made on purpose,
with no warning, as a side effect of typing. Predictability was chosen over cleverness here.

### Preview and export are the same renderer, so parity is structural, not engineered

This is a decision the project revisited, not the original one. The MVP shipped with two independent
text-layout engines — a browser preview and an ffmpeg/libass burn-in — and treated their agreement as
the single largest correctness risk in the project: two engines, by different teams, for different
purposes, that merely *should* produce the same pixels for the same style document, with nothing
actually enforcing it.

That risk is gone by construction now, not by validation. Export no longer asks libass to interpret
the style document a second time — it drives a headless Chromium instance to render the *same*
frontend caption component the live preview uses, seeks it to each video frame, screenshots the
transparent result, and composites that sequence onto the source video with ffmpeg. There is only one
implementation of wrap rules, safe-area math, glow, per-word highlight timing, and every entrance
animation, because there is only one renderer. A style bug shows up identically in both places,
because both places are the same code path.

What this doesn't remove: headless Chromium is the same rendering *engine* as the user's browser, but
not automatically the same *environment* — font availability and load timing are a real seam (the
render surface waits on `document.fonts.ready`, but a slow network can still stretch that wait). And
the risk reappears in a narrower form if export's rendering path is ever allowed to fork from the
shared component for a performance shortcut — that would be a regression to the old two-renderer
problem, not a neutral optimization.

### Everything is relative, nothing is absolute pixels

Font size, safe-area margins, and vertical position are all stored as fractions — of video height, or
of video dimensions — never as absolute pixel counts. A `fontSize` of `0.05` means 5% of video height,
resolving differently on a 1080px-tall video than a 4K one, by design. This exists specifically to
keep preview and export from disagreeing across different source resolutions, which is exactly the
kind of drift the previous point warns about. Font-size, safe-area, and position *bounds* are also not
one global constant — each preset defines its own valid range, so a "bold statement" preset and a
"dense subtitle" preset don't have to share limits that don't make sense for either of them.

The same lesson got relearned the hard way once, on glow/shadow/outline specifically: they were
originally implemented as fixed pixel radii (`20px` glow, `6–24px` shadow blur). That looks fine at
the editor's small preview box and wrong at export resolution, for the exact reason `fontSize` itself
is a fraction and not a pixel count — a `20px` glow is 80% of the glyph height in a 500px-tall preview
and roughly a fifth of that at 4K. Fixed to the same rule as everything else: every decoration radius
is now a fraction of the resolved font size, so it scales with the text instead of silently drifting
away from it as resolution changes.

### Whole-document writes only — no PATCH, anywhere

Both the caption content and the caption style are read and written as complete documents. There's no
per-word or per-field update endpoint. This was a deliberate simplification: it keeps the contract
small now, and it composes cleanly with autosave later, since autosave under this model is just
calling the same "replace the whole document" operation more often — not a different contract shape.
The cost is accepted explicitly: no optimistic concurrency, no version field, last-write-wins. Fine
for a single-editor MVP; flagged as something to revisit if concurrent editing ever becomes real.

### Hard delete, permanently — a standing decision, not a placeholder

Deleting a project is a hard delete: the database row and every file under that project's storage
directory, gone, in one pass. No trash, no recovery, no soft-delete flag. This was confirmed as a
decision that holds *even once real authentication exists* later — not "hard delete because there's
no auth yet to make it dangerous," but "hard delete, full stop, forever." Worth noting because it's
the kind of decision that's easy to quietly walk back under pressure once a user asks "can I get that
back," and the project's stance is that this should be a conscious redesign if it ever happens, not a
default that erodes silently.

### Postgres from day one, not SQLite

Every entity carries an `owner_id` from its very first schema, even though in single-user operation
it always resolves to one hardcoded placeholder. The idea is that adding real multi-user auth later
becomes "stop hardcoding the placeholder," not "add ownership to every table and migrate." Postgres
was chosen over the simpler SQLite specifically so that decision doesn't force a database migration
at the exact moment real users show up — and because SQLite's single-writer lock doesn't sit well with
Celery workers updating job status concurrently, even at today's scale. The general rule behind this
and several other choices in the project: **decisions that are expensive to retrofit are made
correctly now; decisions that are cheap to add later are deliberately deferred.** No payments, no real
auth, no cloud storage today — but the seams for all three already exist.

### Redis is never a source of truth

Redis holds exactly two things today: an in-progress export's percentage complete, and the OS process
id of the ffmpeg process rendering it (so a cancel request knows what to kill). If Redis is
unreachable, both degrade to "not shown" / "can't be cancelled anymore" — never to a stuck job, a
wrong status, or a crash. The job's actual status (`queued`/`processing`/`done`/`failed`/`cancelled`)
always lives in Postgres, never in Celery's own result backend either, for the same reason: exactly
one system is ever allowed to be authoritative about "what's actually happening," so there's no case
where two sources disagree and something has to arbitrate between them.

### Cancelling an export kills a real OS process, carefully

Cancelling a render doesn't rely on Celery's own task revocation — under the worker pool this project
uses, a revoked task's signal isn't reliably delivered to a grandchild subprocess, which would leave
ffmpeg running unsupervised, writing an output file nobody's tracking anymore. Instead, the ffmpeg
process is launched in its own OS process group, its pid is tracked in Redis while it runs, and
cancellation sends a signal directly to that process group by pid. The partial output file is deleted
as part of the same cleanup path used for a genuine failure, not a separate special case.

### The Initial Splitter has no idea what the caption will look like

The first automatic phrase grouping happens *before* the user has chosen a style — before any font,
size, or safe-area width is known. It's therefore built as a coarse, fast heuristic (roughly:
word/character counts) aimed at producing *readable* groupings, not pixel-accurate ones. The precise
"does this actually fit on screen" check happens later and separately, in the Layout Engine, once a
real style exists to measure against. The splitter itself is written behind a fixed
`Words[] → Segments[]` interface specifically so its algorithm can be swapped later (pause-based,
punctuation-based, or LLM-based) without the rest of the system — or the data model — needing to
change at all.

### Overflow never silently mutates anything

When caption text doesn't fit — even after wrapping to the maximum two lines — the system does not
auto-shrink the font, auto-split the segment, or auto-truncate the text. It flags the block visually
and stops. The user resolves it explicitly: shrink the font, change the style, split manually, or
regroup. This mirrors the Recalculate Groups philosophy above — the system is willing to tell the user
something is wrong, but it does not take an irreversible corrective action on their document without
being asked to.

### Export speed is bound by round trips to the browser, not by pixel count

Once burn-in moved to headless-Chromium rendering, the obvious first optimization — screenshot only
the cropped region containing the caption instead of the full frame — measured out to a 3% speedup,
not the expected 4×. The actual cost is dominated by round-trip overhead to the browser (screenshot
encoding time barely changes with crop size), so the lever that actually matters is *how many browser
instances render frames at once*, not how many pixels each one covers. Separate OS processes, not
extra tabs in one browser: tabs funnel their screenshot calls through one browser process that
serializes them, which measured out to roughly 1.5× from four tabs versus roughly 3.5× from four
separate browser processes. Shrinking the capture window to just the caption's own bounding box
*did* end up mattering, just for a different reason than pixel count — a smaller browser viewport is
cheaper to composite per frame regardless of crop.

The number of parallel renderers is a tunable (`AMEE_RENDER_CONCURRENCY`, default 4), not a hardcoded
constant, because the right number depends on the host's cores and spare memory — each browser
instance costs roughly 250MB while an export runs.

### A real bug this surfaced: ffmpeg's progress output lies about its own units, and lies twice

Two ffmpeg quirks worth remembering if you touch the export pipeline. First, ffmpeg's own
`-progress` machine-readable output field is named `out_time_ms` but has actually reported
*microseconds* since the flag was introduced — a known, long-standing naming bug kept for backwards
compatibility. The code here uses `out_time_us` instead, sidestepping the trap by using the honestly
named field rather than remembering to divide by the wrong number. Second, that same field reports the
literal string `"N/A"` on the first several progress lines of any render, before the first frame has
actually been encoded — which is not an error, just "nothing to report yet," but will crash a naive
`int()` conversion if that case isn't handled explicitly. Both are the kind of thing that only shows
up against a real video with a real encode delay, not a short synthetic test fixture — worth a comment
at the call site for exactly that reason.

### A "new" style option has to change pixels, not just carry a new label

The caption entrance-animation catalog grew from 9 to 33 named options, sourced from a design
reference cataloguing dozens of motion styles. A number of them were rejected on the way in for the
same reason: a gallery card that writes an existing animation value under a new `revealMode` (or vice
versa) is not a new option, it's the same picture with a second name pointing at it — worse than not
offering it, because the two labels can't be told apart once the choice is saved and the editor is
reopened. The bar applied throughout: a card earns a place in the gallery only if it resolves to
pixels no other card already produces.

---

## Known limitations & open questions

Some things are deliberately unfinished, not overlooked — flagged in the architecture doc itself
rather than left to be discovered:

- **Preview/export pixel parity is structural, not yet end-to-end validated.** Export now renders the
  same component preview does (see [Key decisions](#preview-and-export-are-the-same-renderer-so-parity-is-structural-not-engineered)
  above), which removes the old two-renderer risk by construction — but headless Chromium being the
  same *engine* as the user's browser doesn't guarantee the same *environment* (font availability,
  load timing), and that hasn't had a dedicated verification pass yet.
- **Four caption animations exist on the wire but don't render yet.** `karaokeFill`, `karaokeBox`,
  `typewriter`, and `letterCascade` are valid `captionAnimation` values (contract §8) with no
  gallery card and no `CaptionOverlay` implementation — each needs real per-word/per-letter render
  logic, not just a CSS `@keyframes` entry like the other 29 values have (`none` is the 30th valid
  value and deliberately has no keyframe at all).
- **No document versioning / optimistic concurrency.** Last-write-wins on every save. Fine for one
  editor per project; a real problem the moment two people can edit the same project at once.
- **No authentication, no payments, no quota model.** The seams exist (`owner_id` on every entity, a
  natural service-layer checkpoint before export); none of the actual mechanisms are built.
- **Retokenization algorithm is unspecified.** When a user edits a whole phrase's text at once, how
  the new word list's timestamps get redistributed across the original time budget is left as an
  implementation detail, not a fixed algorithm.
- **ASS subtitle export is deferred**, not rejected — SRT is the only subtitle file exported today,
  and it loses word-level timing by construction. ASS would preserve it.

### Backend-only today — no frontend UI yet

These have a real, tested backend implementation but nothing a user can actually click to trigger
them. Worth listing explicitly rather than letting the API surface table above imply otherwise:

- **Recalculate Groups** (`POST /projects/{id}/recalculate-groups`) — no button or menu item
  anywhere in the frontend. The endpoint works; it's simply unreachable from the UI right now.
- **Reset to Raw** (`POST /projects/{id}/reset-to-raw`) — same situation, no UI control exists.
- **Merge two segments** — the Behavior Matrix in `docs/architecture.md` describes this operation,
  but there is no frontend implementation at all yet, not even the pure data-transform function
  (splitting a segment exists; merging does not). No UI, no client code, nothing to wire up yet.
- **`POST /projects/{id}/open`** — the frontend has a typed client function for this, but no page
  calls it. "Last opened" isn't actually tracked from the UI today.
- **"Whole phrase" reveal mode** — `CaptionOverlay` can render all three reveal modes
  (`phrase`/`progressive`/`single-word`) and the wire format supports all three, but the style
  panel's animation picker only ever writes `progressive` or `single-word` — there's currently no
  way to select plain whole-phrase reveal from the UI, even though the rendering code for it works.

The complete, current list — kept in sync with the binding specs, not restated from memory — lives in
`docs/INVARIANTS.md` under "Open."

---

## Further reading

- [`docs/architecture.md`](docs/architecture.md) — the full architecture report: product reasoning,
  the complete data model, segmentation, layout rules, and every decision behind them, in depth.
- [`docs/api-contract.md`](docs/api-contract.md) — the exact wire format: every endpoint, every field,
  every status code.
- [`docs/INVARIANTS.md`](docs/INVARIANTS.md) — a fast-reference checklist distilled from the two
  documents above, organized by subsystem.
- [`docs/AGENTS_WORKFLOW.md`](docs/AGENTS_WORKFLOW.md) — how work on this repository is parallelized
  without different pieces of it colliding.
