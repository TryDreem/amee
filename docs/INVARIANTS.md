# Amee — Invariants

Distilled from `architecture.md` (binding) and `api-contract.md`. Section refs are to those docs.
If this file ever disagrees with `architecture.md`, **architecture.md wins and this file is wrong.**

Used by: the `amee-arch-check` skill, the `arch-reviewer` subagent, and PR review.

---

## Pipeline

| # | Invariant | Ref |
|---|---|---|
| P1 | WhisperX runs **exactly once** per video. No user edit ever triggers a second pass. | arch §1.3, §3 |
| P2 | `POST /projects/{id}/transcribe` returns **409** if a transcribe job is `queued`/`processing`/`done`. A `failed` job does not count. | contract §4 |
| P3 | Initial Splitter runs **synchronously inside the transcribe job**. It has no queue of its own. | arch §5.1, §2.3 |
| P4 | Splitter interface is exactly `Words[] → Segments[]`. It **never receives `CaptionStyleSpec`**. | arch §5.1, §5.3 |
| P5 | Exactly two Celery queues: `transcribe`, `export`. A `split` queue is *designated future*, not built. | arch §2.3, contract §13.11 |
| P6 | Job status lives in the **app database**, not Celery's result backend. `Project` has no `transcription_status` field. | arch §2.3, contract §4 |

## Data model

| # | Invariant | Ref |
|---|---|---|
| D1 | Raw Transcript is **write-once, immutable**. No PUT, no DELETE, ever. Its only purpose is full-project reset. | arch §4.1 |
| D2 | Raw-transcript words carry **no `id`**. There is no per-word link from ECS back to the transcript, and no `original`/`edited` flag. | arch §4.2, contract §6 |
| D3 | Containment, not parallel lists: `ECS → Segment[] → Segment.Word[]`. | arch §4.2 |
| D4 | `Word.start` / `Word.end` are **absolute seconds from video start**, floats. Not segment-relative. Not wall-clock. | arch §4.2 |
| D5 | `Segment` has **no stored `start`/`end`** — not in DB, not in the wire format, not in TS types. Derived as `words[0].start` / `words.at(-1).end`, identically by preview and export. | arch §4.2, contract §7 |
| D6 | Word order within a segment matches ascending `start`. Validated, not assumed. | arch §4.2 |
| D7 | Segment membership (which words in which segment, and segment order) is **authored user data**. Never silently recomputed as a side effect of anything. | arch §4.2, §5.2 |
| D8 | ECS and `CaptionStyleSpec` are read/written as **whole documents**. `PUT` only. Introducing `PATCH` or a per-word endpoint violates the save semantics. | arch §4.2, §6, contract §1 |
| D9 | Every entity except `Preset` carries `owner_id` from the first schema. MVP resolves it to one placeholder UUID. | arch §2.4, contract §1 |
| D10 | All ids are UUIDv4 strings, mintable by the frontend without a server round trip. | contract §1 |
| D11 | `Segment.overrides` is the **one deliberate exception** to Data never carrying Style (cross-ref S1) — a per-segment style override, gated by `CaptionStyleSpec.perPhraseStyle`. Addressed by the segment's own `id`, never array index (index shifts on delete/split/merge). | arch §4.2 |

## Validation (server-side, on `PUT /ecs`)

| # | Rule | Ref |
|---|---|---|
| V1 | `text` non-empty for every word. | arch §4.2 |
| V2 | `start < end` for every word. | arch §4.2 |
| V3 | Words in a segment: non-overlapping and strictly ordered (`prev.end ≤ next.start`). | arch §4.2 |
| V4 | Segments do not overlap each other. | arch §4.2 |
| V5 | Every segment has **at least one word**. Backstop — the frontend drops empty segments before save. | contract §7 |
| V6 | A **minimum word duration is NOT a validation rule.** Ultra-short words are a renderer concern. Do not add it to the validator. | arch §4.2, §8 |
| V7 | No `version` field, no `If-Match`, no optimistic concurrency. Last-write-wins. | contract §7, §13.3 |
| V8 | `segment.overrides`, when present, is validated against the *same resolved preset bounds* `PUT /style` uses — not a separate per-segment preset. Same 422 shape as V1-V5. | arch §4.2, contract §7 |
| V9 | `Segment.id`/`Word.id` unique **within the document** — contract §7's one hard requirement on the id lifecycle, enforced server-side so a duplicate is a 422, not a DB primary-key 500. | contract §7 |

## Editing behavior

| # | Invariant | Ref |
|---|---|---|
| E1 | Word-boundary drag **clamps** to neighbors. Never push the neighbor's far boundary outward. | arch §4.2 |
| E2 | An inserted word gets a locally-estimated timestamp. No re-alignment against audio. | arch §4.2 |
| E3 | Recalculate Groups is **user-triggered only**. Never on keystroke, never after a style change, never on save. It replaces `Segments[]` entirely and touches nothing in `CaptionStyleSpec`. | arch §5.2 |
| E4 | Recalculate Groups after a style-only change would be a **no-op by construction** (the splitter never sees style). Do not "optimize" by calling it. | arch §5.2 |
| E5 | Undo/redo is **entirely frontend**. One unified history stack, no special-casing per action type — including Recalculate Groups, Reset to Raw, and style changes. The backend has no history endpoint. | arch §11 |
| E6 | `POST /recalculate-groups` and `POST /reset-to-raw` **do not persist** and **do not touch the undo stack**. They compute and return; the frontend adopts the result. | contract §10, §11 |
| E7 | Both endpoints are **polymorphic**: `200 {segments}` for a cheap splitter, `202 {job}` for an expensive one. Clients must check the shape, not assume `200`. | contract §10 |
| E8 | Recalculate Groups and Reset to Raw **wipe every segment's `overrides`** by construction (P4: the splitter never receives style, so it cannot produce or preserve override data). Settled default (arch §14 item 15) — do not "fix" this with a match-by-content preservation heuristic without asking. | arch §4.2, §14.15 |

## Style / Layout / Data separation

| # | Invariant | Ref |
|---|---|---|
| S1 | Data says *what and when*. Style says *how*. Layout says *where*. No layer reaches into another's job. | arch §6 |
| S2 | The Layout Engine **never mutates** ECS or `CaptionStyleSpec`. It reads, and it emits a rendering or a "doesn't fit" signal. | arch §6, §8.3 |
| S3 | Style edits live in frontend state while the user adjusts them. The backend receives `CaptionStyleSpec` only on save or export. No round trip per slider tick. | arch §6 |
| S4 | Preset switch = `presetId` replaced, `overrides` reset to `{}`. Frontend state only. There is no "apply preset" endpoint. | arch §7, contract §9 |
| S5 | `highlightColors` (plural, array) cycles by **segment index**, not id: `highlightColors[segmentIndex % length]`. Computed identically by preview and export (R2). | arch §6, contract §8 |
| S6 | `outline.alpha`/`shadow.alpha` validate against a **fixed 0-100 range**, not per-preset bounds — unlike `fontSize`/`verticalPosition`/`safeArea` (L8). `textTransform`, `italic`, `glow`, `outline.size`, `shadow.size` have **no bounds check at all**; any value from the type is valid. | arch §10, contract §8 |
| S7 | `showPunctuation` (`StyleOverrides`/`PresetBase`, default `false`) strips sentence punctuation from *displayed* text only, at render time — `Word.text` is never mutated (same rule as `textTransform`, S1). Exact rule: strip `. , ! ? ; : — –` and `..`/`...` ellipsis runs (removed as a unit, not kept as a pause); apostrophes within a word and hyphens between two letters are preserved. A word that strips to empty is dropped from the joined text but still occupies its own timeline slot. Preview and export must implement the identical rule (R2 cross-ref). | arch §6, contract §8 |
| S8 | `revealMode: "single-word"` renders only the active word — others are absent from output, not hidden-but-present. `captionAnimation` (`"none"\|"fade"\|"pop"\|"bounce"\|"blur"\|"snap"`) is a cosmetic entrance transition, orthogonal to `revealMode`, no bounds check. | arch §6-7, contract §8 |


## Layout & positioning

| # | Invariant | Ref |
|---|---|---|
| L1 | Fit is decided by **measuring rendered width** against the safe-area-derived available width. Never by word count. | arch §8.1 |
| L2 | Wrap **only between words**. A word is never split across lines. | arch §8.2 |
| L3 | **Maximum 2 visual lines.** A third line is an overflow condition, not a solution. | arch §8.2 |
| L4 | On overflow: **no automatic data mutation.** No auto-shrink, no auto-split, no auto-truncate. Visual error state; the user resolves it. | arch §8.3 |
| L5 | Horizontal alignment is **center, fixed**. No `horizontalAlign` field anywhere. | arch §9.1, contract §8 |
| L6 | `verticalPosition` ∈ [0,1] relative to video height. Out-of-safe-area ⇒ visual warning, never silent clamping, never silent acceptance. | arch §9.2 |
| L7 | `fontSize` is a fraction of video height, never pixels. | arch §10 |
| L8 | Bounds (`fontSize`, `verticalPosition`, `safeArea`) live **per preset**, not as global constants. `PUT /style` validates against the resolved preset's `bounds`. | arch §9.3, §10, contract §8 |

## Rendering

| # | Invariant | Ref |
|---|---|---|
| R1 | Two independent renderers exist: browser preview (CSS/Canvas) and export (ffmpeg/libass). Their agreement is a **design goal that must be engineered and validated**, not an assumption. This is the largest correctness risk in the project. | arch §12 |
| R2 | Both must resolve relative units to the same pixels, apply the same wrap rules, the same 2-line max, the same safe-area math, and the same `verticalPosition` mapping. Code-level parity of the wrap decision where feasible. | arch §12 |
| R3 | Not yet validated. Any PR claiming "preview matches export" without a frame-diff artifact is claiming something unverified. | arch §12 |

## Export

| # | Invariant | Ref |
|---|---|---|
| X1 | MVP produces all three per export: burned-in video, SRT, internal project JSON. | arch §2.5, contract §12 |
| X2 | SRT loses word-level timing. Known and accepted. Do not "fix" it by inventing an SRT extension. | arch §2.5 |
| X3 | ASS export is **deferred**. No endpoint, no flag. (ASS may still be used internally as the libass intermediate.) | arch §2.5, §14.5 |
| X4 | `json_url` is one self-contained bundle (`ecs` + `style` together). This does not reopen the two-endpoint persistence split. | contract §12 |
| X5 | `POST /export` persists both documents as a side effect, then enqueues. One validation path shared with `PUT /ecs` / `PUT /style`. | contract §12 |

## Architecture hygiene

| # | Invariant | Ref |
|---|---|---|
| A1 | Service-layer functions take and return plain serializable data. Never a `Request`/`Response` object. This is what makes the Celery adapter thin. | arch §2.2, §2.3 |
| A2 | File access goes through `storage.py`. No direct disk paths in services or routes. | arch §2.1 |
| A3 | Redis, if introduced, is **never a source of truth** for anything. Unavailable Redis ⇒ slower, never wrong, never stuck. | contract §14 |
| A4 | Quota/payment checks, when they land, sit at the service-layer boundary before expensive operations (export). Not in routes. | arch §2.4, contract §13.12 |

---

## Open — an agent must never silently pick a default

`architecture.md` §14 and `api-contract.md` §13. Touching any of these means stopping and asking:

1. Retokenization algorithm for whole-phrase edits (arch §14.6)
2. `Word.id` reuse vs. regeneration at retokenization (contract §13, last row)
3. UI confirmation before Recalculate Groups (arch §14.10)
4. Empty-segment behavior beyond the V5 backstop (arch §14.8 — contract §7 resolves the backend half only)
5. Document versioning (arch §14.3)
6. Autosave (arch §14.4 — excluded from MVP by design, not by omission)
7. Per-word link back to Raw Transcript (arch §14.7 — cheap now, expensive later; a conscious call, not a default)
8. Payment/quota model (arch §14.12) · Auth mechanism (arch §14.13)
9. Preset+delta **wire shape** — contract §8 marks it inferred, awaiting confirmation
10. Upload vs. transcribe as two calls (contract §4, self-flagged)
11. Export bundling + side-effect persistence (contract §12, self-flagged)

## Known gap, not covered by either document

Nothing in the contract enforces R1/R2. The two renderers can drift silently and no test catches it.
A shared golden-fixture suite (`layout/fixtures/*.json`: inputs → expected line breaks and pixel
boxes, executed against both implementations) would close it. **This is a proposal, not a decision** —
it needs the human's sign-off before any agent builds it.
