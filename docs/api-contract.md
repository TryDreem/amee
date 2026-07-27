# Amee — API Contract (v1)

**Relationship to the architecture doc:** this document is the step named at the end of *Caption Editor — Architecture Report* ("the architecture doc"). It fixes exact endpoints and JSON shapes for the MVP backend. Every design choice below either (a) directly implements something the architecture doc already locked in, or (b) is a new decision made explicit here because the architecture doc left it open — in both cases the reasoning is included, not just the conclusion, in the same spirit as the source document. §13 maps every open question from the architecture doc's §14 to its resolution here.

This document assumes the reader has the architecture doc; it implements that data model, it does not re-derive it.

---

## Table of Contents

1. [Conventions](#1-conventions)
2. [Typical Flow](#2-typical-flow)
3. [Resource Index](#3-resource-index)
4. [Projects & Transcription](#4-projects--transcription)
5. [Jobs](#5-jobs)
6. [Raw Transcript](#6-raw-transcript)
7. [Edited Caption Structure](#7-edited-caption-structure)
8. [CaptionStyleSpec](#8-captionstylespec)
9. [Presets](#9-presets)
10. [Recalculate Groups](#10-recalculate-groups)
11. [Reset to Raw Transcript](#11-reset-to-raw-transcript)
12. [Export](#12-export)
13. [Architecture Doc §14 — Resolved / Still Open](#13-architecture-doc-14--resolved--still-open)
14. [Infrastructure Notes (Non-Contract)](#14-infrastructure-notes-non-contract)

---

## 1. Conventions

- **Base path:** `/api/v1` (arbitrary, not dictated by the architecture doc).
- **IDs:** every resource id — `Project`, `Job`, `Segment`, `Word`, `Preset` — is a **UUIDv4 string**. This isn't a style preference: content edits (add/delete/edit word, retokenization) happen entirely on the frontend without a backend round trip (architecture doc §4.2, §6), so the frontend must be able to mint new `Word`/`Segment` ids on its own, with zero collision risk against ids the backend mints elsewhere (Initial Splitter, Recalculate Groups, Reset). Sequential integer ids would require server coordination on every keystroke, which the architecture is explicitly built to avoid.
- **Ownership:** every persisted entity **except `Preset`** carries `owner_id` (architecture doc §2.4 names project, transcript, caption document, export job explicitly; presets are shared system templates, not user content, so they're the one resource that doesn't carry it). In the MVP, `owner_id` always resolves to one hardcoded placeholder UUID.
- **Field naming:** infrastructure/identity fields (`id`, `owner_id`, `project_id`, `created_at`, `updated_at`, `video_url`) use `snake_case`, matching how the architecture doc itself writes `owner_id`/`user_id`. `CaptionStyleSpec` fields use `camelCase` (`verticalPosition`, `safeArea`, `fontSize`), matching the architecture doc's own JSON examples in §9–§10. `Word`/`Segment` content fields (`id`, `text`, `start`, `end`) are single lowercase words — no separator needed.
- **Whole-document writes only:** ECS and `CaptionStyleSpec` are both `PUT`, never `PATCH`. The architecture doc's save semantics (§4.2, §6) are explicitly "read/write the whole document"; offering `PATCH` would invite partial-update usage that contradicts that.
- **Schema notation:** JSON blocks below use TypeScript-like placeholders (`string`, `number`, `boolean`, `"a" | "b"` for enums, `Type | null`, `Type[]`) rather than real values, unless a block is explicitly marked **Example**.
- **Errors:** every 4xx/5xx returns
  ```json
  {
    "error": {
      "code": "string",
      "message": "string",
      "details": [ { "field": "string", "issue": "string" } ]
    }
  }
  ```
- **Timestamps:** `created_at`/`updated_at` are ISO 8601 strings. `Word.start`/`Word.end` are **not** wall-clock timestamps — they're floating-point seconds offset from video start (architecture doc §4.2), and stay that way here.
- **Rate limiting:** every response may carry `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers. On limit exceeded:
  ```json
  429
  {
    "error": {
      "code": "rate_limited",
      "message": "string",
      "details": [ { "field": "owner_id", "issue": "retry after N seconds" } ]
    }
  }
  ```
  with a `Retry-After` header (seconds). **Not enforced in the MVP** — one placeholder `owner_id`, nothing to limit against yet — but the response shape is fixed now, not later, so the frontend can handle `429` before enforcement exists rather than needing a client update the day it's turned on. The limiting key is `owner_id`, matching the field already present on every entity (§ above) — this becomes per-user automatically once real auth lands, no contract change needed. Enforcement itself (middleware/decorator on the API layer) is cheap to add later per architecture doc §1.2's own rule, so it isn't built now.

---

## 2. Typical Flow

```
POST /projects              (upload video)                    → Project
POST /projects/{id}/transcribe                                 → Job (transcribe)
GET  /jobs/{jobId}           (poll until status = done)
GET  /projects/{id}/ecs   +  GET /projects/{id}/style           → editor loads
  ... user edits locally, frontend-only, per architecture doc §4.2 / §6 ...
PUT  /projects/{id}/ecs   +  PUT /projects/{id}/style            (on save)
POST /projects/{id}/export                                      → Job (export)
GET  /jobs/{jobId}           (poll until status = done)          → result.video_url / srt_url / json_url
```

---

## 3. Resource Index

| Resource | Endpoints |
|---|---|
| Project | `POST /projects` · `GET /projects` · `GET /projects/{id}` |
| Transcription | `POST /projects/{id}/transcribe` |
| Job | `GET /jobs/{id}` |
| Raw Transcript | `GET /projects/{id}/raw-transcript` |
| Edited Caption Structure | `GET /projects/{id}/ecs` · `PUT /projects/{id}/ecs` |
| CaptionStyleSpec | `GET /projects/{id}/style` · `PUT /projects/{id}/style` |
| Presets | `GET /presets` |
| Recalculate Groups | `POST /projects/{id}/recalculate-groups` |
| Reset to Raw Transcript | `POST /projects/{id}/reset-to-raw` |
| Export | `POST /projects/{id}/export` (video only, persists ecs + style) · `POST /projects/{id}/export-srt` (SRT only, does not persist) |


Project management beyond create/list (rename, delete, sharing) is intentionally out of scope for this pass — nothing in architecture doc §14 calls for it, and it wasn't part of what this contract set out to fix.

---

## 4. Projects & Transcription

### `POST /projects`
`multipart/form-data`: video file, optional `name`, optional `language` (ISO 639-1 code, e.g.
`"ru"`; omitted or explicit `null` = auto-detect — architecture doc §2.9).


Creates the `Project` and stores the video via the storage abstraction (architecture doc §2.1) — nothing more. **Does not start processing** — that's a separate, explicit call. This is a genuine design fork, not something forced by the architecture doc: an equally valid design would auto-start processing on upload. Kept separate here because processing (transcription, probing, thumbnail, preview proxy — architecture doc §2.8) is a real cost-incurring action, and an explicit trigger makes that visible rather than implicit in an upload call — flagged in §13 as worth a second look, not a forced conclusion.

`CaptionStyleSpec` is initialized immediately, using the preset flagged `"default": true` (§9) — style doesn't depend on transcription at all (architecture doc §6 treats them as fully independent axes), so there's no reason to make the user wait on WhisperX before they can see style options.

Video width/height/duration, a thumbnail, and (conditionally) a preview proxy are all produced by the same async job that runs WhisperX (architecture doc §2.8) — **not** at upload time. `POST /projects` returns immediately with those fields `null`; the Layout Engine's fit calculations (architecture doc §8.1) wait on `GET /jobs/{id}` reaching `status: "done"`, same as the caption editor does.

**Validation:** rejects the upload against the limits in architecture doc §2.7 — format not mp4/mov, codec not H.264/HEVC, resolution over 4K (3840×2160), file size over 2GB, or `language` present and not one of WhisperX's supported ISO 639-1 codes (architecture doc §2.9).
**422** with `error.details` identifying which limit was exceeded (§1's envelope — no separate shape for uploads).


**201** →
```json
{
  "id": "uuid",
  "owner_id": "uuid",
  "name": "string",
  "video_url": "string",
  "language": "string | null",
  "thumbnail_url": "string | null",
  "preview_video_url": "string | null",
  "video_width": "number | null",
  "video_height": "number | null",
  "video_duration_seconds": "number | null",
  "created_at": "ISO8601 string",
  "latest_transcribe_job_id": "uuid | null",
  "export_job_ids": "uuid[]"
}
```

`thumbnail_url` and `video_width`/`video_height`/`video_duration_seconds` are all populated by the
same ffmpeg-probe-and-thumbnail step (architecture doc §2.8) and become non-null together, once that
step completes.

`preview_video_url` is populated once the preview-proxy step completes (architecture doc §2.8):
equals `video_url` if the source is ≤1080p (no separate file was ever generated), or the downscaled
proxy's URL otherwise. Also `null` until that step finishes.

Note what's **not** here: no `transcription_status` field. Status lives only on the `Job` record (§5) — duplicating it onto `Project` would recreate exactly the "two divergent sources of truth" problem the architecture doc explicitly designed the job system to avoid (§2.3). The client resolves status via `latest_transcribe_job_id` → `GET /jobs/{id}`.

`language` is set once at creation and never changes — no `PUT /projects/{id}` exists to alter it
(architecture doc §2.9). `null` means auto-detect and is the default when the field is omitted from
the request.


### `GET /projects` / `GET /projects/{id}`
Same shape as above. List / single fetch. `404` if not found.

### `POST /projects/{id}/transcribe`
No body. Creates a `Job` (`type: "transcribe"`) on the `transcribe` queue. Despite the name, this job
now orchestrates four parallel steps, not just transcription: WhisperX (then the Initial Splitter
synchronously in the same branch), the ffmpeg probe, thumbnail extraction, and the conditional
preview-proxy transcode (architecture doc §2.8). `type: "transcribe"` and the queue name are kept as
they are — this is still one `Job`, still governed by the same `transcribe`/`export` two-queue split
(architecture doc §2.3) — the name just now covers more than the literal word suggests.

**Guard:** if `latest_transcribe_job_id` points at a job whose status is `queued`, `processing`, or `done`, this returns **409** — transcription runs exactly once per video (architecture doc §1.3), and the API enforces that, not just the frontend's own discipline. A prior `failed` job doesn't count against that budget (it never produced a result), so retrying after a failure is allowed.

**202** → `Job` object (§5).

---

## 5. Jobs

### `GET /jobs/{id}`
One shape, shared by both queues (architecture doc §2.3 — status is application-owned, not read from Celery):

```json
{
  "id": "uuid",
  "project_id": "uuid",
  "owner_id": "uuid",
  "type": "transcribe" | "export" | "export_srt",
  "status": "queued" | "processing" | "done" | "failed",
  "progress": "preparing" | "transcribing" | "generating_preview" | null,
  "thumbnail_url": "string | null",
  "created_at": "ISO8601 string",
  "updated_at": "ISO8601 string",
  "error": "string | null",
  "result": null
    | { "video_url": "string" }              // type: "export"
    | { "srt_url": "string" }                // type: "export_srt"
}
```

`progress` (architecture doc §2.8) is only meaningful while `status: "processing"` — `null` at every
other status. It names the current bottleneck across the transcribe job's four parallel steps on a
best-effort basis, not a strict per-step state machine; clients poll `GET /jobs/{id}` (~2s interval)
the same way they already poll for status (contract §14 — the app database stays the source of
truth either way).

`result` is always `null` for `type: "transcribe"` — a completed transcription is signaled by `status: "done"` alone; the actual data is fetched via `GET /ecs` and `GET /raw-transcript` once that's true, not duplicated into the job. `result` is populated only for `type: "export"`/`"export_srt"`, and only once `status: "done"` — its shape depends on `type` (see §12).


---

## 6. Raw Transcript

### `GET /projects/{id}/raw-transcript`
`404` until the transcribe job is `done`.

```json
{
  "project_id": "uuid",
  "owner_id": "uuid",
  "words": [ { "text": "string", "start": "number", "end": "number" } ],
  "language": "string | null"
}
```

No `id` per word. The architecture doc is explicit that a `Word` in the ECS carries no link back to a raw-transcript word (§4.2, §14 item 7) — giving raw-transcript words stable ids would imply an addressability that was deliberately excluded. This endpoint is otherwise **read-only forever**: no `PUT`/`DELETE`, matching immutability (architecture doc §4.1). `language` is what WhisperX actually detected/used for alignment — distinct from `Project.language` (§4, the user's upload-time choice, set once and never mutated, §2.9), which stays `null` forever if the user picked "auto." `null` here means the row predates this field, not that detection failed.

---

## 7. Edited Caption Structure

### `GET /projects/{id}/ecs`
`404` until the transcribe job is `done` — the ECS is created by the Initial Splitter inside that job (architecture doc §3, §5.1), so it doesn't exist before that.

```json
{
  "project_id": "uuid",
  "owner_id": "uuid",
  "segments": [
    {
      "id": "uuid",
      "overrides": { "...same sparse shape as CaptionStyleSpec.overrides, §8..." } | null,
      "words": [ { "id": "uuid", "text": "string", "start": "number", "end": "number" } ]
    }
  ]

}
```

`overrides` is the one deliberate exception to Segment being pure Data (architecture doc §4.2) — addressed by the segment's own `id`, never by position in the array.


**No `start`/`end` on `Segment`.** The architecture doc is explicit that segment bounds are derived, never stored (§4.2: "any value that can be derived from the words must be derived, never stored redundantly"). Putting them in the wire format anyway would just relocate the same problem one layer over — the backend would either have to trust a client-sent value that might disagree with the words (a validation footgun) or silently recompute and discard it (making the field a lie). Omitting it keeps the rule intact end-to-end; the frontend computes `words[0].start` / `words.at(-1).end` itself, one line either way.

### `PUT /projects/{id}/ecs`
`404` under the same condition as `GET` — there's no document to overwrite before the Initial Splitter has produced the first one.

Body: `{ "segments": [...] }` — same shape as the `GET` response, minus `project_id`/`owner_id` (those come from the URL/session, not the body; a client shouldn't be able to set `owner_id` by hand once real auth exists, even though it's a no-op today).

- **Per-segment edit limits:** every segment's word count and joined text length are checked against
  `EDIT_MAX_WORDS_PER_SEGMENT` / `EDIT_MAX_CHARS_PER_SEGMENT` (architecture doc §7.1) — **422** if
  either is exceeded. Same numeric values as the Initial Splitter's own constants today, but validated
  independently — this is not the splitter running again, just a defensively-duplicated check of what
  the frontend already prevents interactively.


**`Word.id` lifecycle:** ids are opaque, client-supplied UUIDs. This contract does **not** require that a retokenization-style edit (architecture doc §4.2) reuse existing `Word.id` values where possible versus regenerating the whole list — that choice is left to editor implementation, to be decided alongside the text-editing UX. The only requirement is that ids are unique within the document. Nothing about validation, storage, or any other endpoint depends on which strategy the editor ends up using.

**Validation (server-side), directly from architecture doc §4.2:**
- every word: non-empty `text`, `start < end`
- words within a segment: non-overlapping, strictly ordered (`previous.end ≤ next.start`)
- segments: non-overlapping with each other
- **every segment has at least one word.** This is the backend half of the empty-segment decision: deleting the last word in a segment is a frontend-only content edit (architecture doc §4.2/§6), so the frontend is expected to drop the now-empty segment itself before the user ever saves. This rule is the defensive backstop — if an empty segment somehow reaches `PUT /ecs` anyway, the backend rejects it rather than silently accepting a segment with undefined bounds.
- **`segment.overrides`, if present:** its `fontSize`, `verticalPosition`, and `safeArea` fields (when present in the override) are validated against the *same resolved preset's* `bounds` (§9) as `PUT /style` uses — checked against the project's `CaptionStyleSpec.presetId`, not a separate per-segment preset. Same rejection behavior: **422** if out of range. This closes the open question of whether per-phrase overrides bypass preset bounds — they do not.

**200** → the persisted document, echoed back. **422** with `error.details` on validation failure. No version bump, no `If-Match` / optimistic-concurrency check — last-write-wins, matching the decision not to introduce versioning for the MVP.

---

## 8. CaptionStyleSpec

### `GET /projects/{id}/style` / `PUT /projects/{id}/style`
Available immediately from project creation (§4) — never `404`s the way ECS does, since style doesn't depend on transcription (architecture doc §6).

```json
{
  "project_id": "uuid",
  "owner_id": "uuid",
  "presetId": "uuid",
  "perPhraseStyle": "boolean",
  "overrides": {
    "fontSize": "number",
    "fontFamily": "string",
    "fontWeight": "string | number",
    "color": "string",
    "highlightColors": "string[]",
    "textTransform": "none" | "uppercase",
    "italic": "boolean",
    "glow": "boolean",
    "outline": { "size": "none" | "small" | "medium" | "large", "color": "string", "alpha": "number" } | null,
    "shadow": { "size": "none" | "small" | "medium" | "large", 
    "color": "string", "alpha": "number" } | null,
    "showPunctuation": "boolean",
    "revealMode": "phrase" | "progressive" | "single-word",
    "captionAnimation": "none" | "fade" | "pop" | "bounce" | "blur" | "snap",

    "verticalPosition": "number",
    "safeArea": { "top": "number", "bottom": "number" }
  }
}



```

`overrides` is sparse — only fields that differ from `presetId`'s base values need to be present; anything absent falls back to the preset. **Flagging this explicitly:** the architecture doc references a "preset plus delta" model as already established in earlier discussion (§6) without giving its wire shape in the document itself. The structure above is a best-effort rendering of that concept, not a re-derivation from anything written down — worth a quick confirmation that it matches what was actually agreed, since this document doesn't have that earlier context to check against.

`highlightColors` cycles by segment index, not a single global color: `color = highlightColors[segmentIndex % highlightColors.length]`. The whole segment is painted with that one color; which word is currently active within the segment is controlled by `revealMode`, not by swapping colors. Preview and export must implement the identical indexing formula (§12 — parity risk).

`showPunctuation` (default `false`) strips sentence punctuation from displayed text only — `Word.text` in ECS is never mutated, same rule as `textTransform`. Exact strip rule: remove `. , ! ? ; : — –` and `..`/`...` ellipsis runs (removed as a unit, not kept as a pause); apostrophes within a word (`don't`) and hyphens between two letters (`well-known`) are preserved. A word that strips to an empty string is dropped from the joined display text but keeps its own timeline slot (still occupies its `[start, end)` window for highlight/reveal purposes). Preview and export must implement the identical rule (§12 — parity risk).

`revealMode: "single-word"` renders only the currently-active word — every other word in the
segment must be absent from the rendered/exported output at that instant, not merely styled to be
invisible (§12 parity risk, same class of bug as the `showPunctuation` strip rule above).

`captionAnimation` is unrelated to `revealMode` and has no validation beyond its enum — any value
from the type is valid, no bounds check, same treatment as `textTransform`/`italic`/`glow`.


No `horizontalAlign` field — horizontal centering is fixed renderer behavior in the MVP, not a configurable style property (architecture doc §9.1), so there's nothing to represent here yet.

`PUT` validation: `verticalPosition` and each `safeArea` bound, if present in `overrides`, must fall within the *resolved preset's* bounds (§9) — checked against `presetId`'s `bounds`, not a global constant, per architecture doc §10's explicit rejection of one hardcoded range. `textTransform`, `italic`, `glow`, `outline.size`, `shadow.size`, `revealMode`, and
`captionAnimation` have no bounds — any value from their type is valid.
`outline.alpha` and `shadow.alpha` are validated against a fixed `0-100` range, not a per-preset one.


---

## 9. Presets

### `GET /presets`
Not project-scoped, no `owner_id` — global and shared, not user content (§1).

```json
[
  {
    "id": "uuid",
    "name": "string",
    "default": "boolean",
    "base": {
      "fontSize": "number",
      "fontFamily": "string",
      "fontWeight": "string | number",
      "color": "string",
      "highlightColors": "string[]",
      "textTransform": "none" | "uppercase",
      "italic": "boolean",
      "glow": "boolean",
      "outline": { "size": "none" | "small" | "medium" | "large", "color": "string", "alpha": "number" } | null,
      "shadow": { "size": "none" | "small" | "medium" | "large",
      "color": "string", "alpha": "number" } | null,
      "showPunctuation": "boolean", 
      "revealMode": "phrase" | "progressive" | "single-word",
      "captionAnimation": "none" | "fade" | "pop" | "bounce" | "blur" | "snap",
      "verticalPosition": "number",

      "safeArea": { "top": "number", "bottom": "number" }
    },
    "bounds": {
      "fontSize": { "min": "number", "max": "number" },
      "verticalPosition": { "min": "number", "max": "number" },
      "safeArea": {
        "top": { "min": "number", "max": "number" },
        "bottom": { "min": "number", "max": "number" }
      }
    }

  }
]


```

`default: true` on exactly one preset — this is what `POST /projects` uses to initialize a new project's style (§4), instead of an implicit and fragile "first in the list" convention.

**No "apply preset" endpoint.** Per the behavior matrix (architecture doc §7): a preset switch replaces `CaptionStyleSpec` in frontend state only (`presetId` = the chosen preset's id, `overrides` = `{}`) — it's the same frontend-only pattern as any other style edit (§6), and only reaches the backend on the next `PUT /style`.

---

## 10. Recalculate Groups

**MVP status:** endpoint implemented, no frontend caller in the MVP (grouping is edited manually).
Same "built, contract-fixed, not surfaced" stance as rate-limiting (§1). Kept because it's a thin
wrapper over the Initial Splitter (§5.1) that already has to exist — removing it would save nothing
and cost a rewrite if reintroduced.

### `POST /projects/{id}/recalculate-groups`

Body:
```json
{ "words": [ { "id": "uuid", "text": "string", "start": "number", "end": "number" } ] }
```

**Why the body carries `words` explicitly, not just a project id:** architecture doc §5.2 is specific that this operates on the *current* `Words[]` — "including every edit the user has made so far" — and content edits are frontend-only until save (§4.2, §6). If this endpoint read the backend's last-*saved* `Words[]` instead, it would silently ignore any unsaved edits, contradicting §5.2 outright. So the request has to carry the live frontend words directly; the endpoint is effectively a stateless exposure of the `Words[] → Segments[]` interface (architecture doc §5.1).

Runs the same backend splitter as the Initial Splitter (architecture doc §5.1, §5.3 — one interface, swappable implementation). **This is exactly why the response is polymorphic**, not a fixed `200`: §5.3 names a future "AI semantic splitter" as one of the swappable strategies, and a language-model-backed splitter has the same cost profile as WhisperX (§1.3) — not "cheap, local, deterministic" like the MVP splitter. Fixing the response shape to always-synchronous now would make swapping to that strategy a breaking API change later; fixing it as polymorphic now makes it a non-event.

```json
// active splitter is cheap (MVP default — Simple Splitter):
200
{ "segments": [ { "id": "uuid", "words": [ { "id": "uuid", "text": "string", "start": "number", "end": "number" } ] } ] }

// active splitter is expensive (e.g. a future AI semantic splitter):
202
{ "job": { "id": "uuid", "type": "split", "status": "queued", "...": "same Job shape as §5" } }
```

A client always checks which shape it got rather than assuming `200`. If `202`, it polls `GET /jobs/{id}` exactly like `transcribe`/`export`; once `done`, the job's `result` carries the same `{ "segments": [...] }` shape the `200` path returns directly. **Whichever shape comes back, the same rules hold: does not persist, and touches nothing about `CaptionStyleSpec`** — the result is adopted into frontend live state and pushed onto the undo stack by the frontend itself (architecture doc §11; §5.2's "no special-case handling" for undo). The backend's role ends at computing and returning `Segments[]`; it never decides what the frontend does with them.

With the MVP splitter, the `202` branch is simply never exercised — no `split` queue exists yet. If/when an expensive splitter strategy lands, a third queue (`split`, alongside `transcribe`/`export`) is the natural home for it, matching the existing rationale for separate queues by load profile (architecture doc §2.3).

---

## 11. Reset to Raw Transcript

### `POST /projects/{id}/reset-to-raw`
No body. `404`/`409` if the project hasn't been transcribed yet — there's no Raw Transcript to reset to.

Re-runs the Initial Splitter over the project's stored Raw Transcript, generating a brand-new `Segment[]`/`Word[]` with fresh ids. Unlike the retokenization case (§7), there's no ambiguity to leave open here: Raw Transcript words carry no id linkage to ECS words at all (§6; architecture doc §4.2), so there's nothing to consider reusing.

**Same polymorphic response as Recalculate Groups (§10), for the same reason:** Reset uses the same Initial Splitter, so it inherits the same future cost risk if that splitter strategy changes (§5.3).

```json
// active splitter is cheap (MVP default):
200
{ "project_id": "uuid", "owner_id": "uuid", "segments": [ "... same shape as GET /ecs ..." ] }

// active splitter is expensive:
202
{ "job": { "id": "uuid", "type": "split", "status": "queued", "...": "same Job shape as §5" } }
```

Does not touch `CaptionStyleSpec` (architecture doc §13, case 7), either way.

**Persistence and undo:** same non-persisting pattern as Recalculate Groups (§10) — the backend returns the new document (directly, or via the job's `result` once `done`); it does not write it to storage, and it does not touch the undo stack, because both of those are frontend concerns (architecture doc §11). This is exactly what makes Reset participating in the *normal* undo stack possible: it's just another "frontend receives a new document, pushes it as one state change" event, the same shape as every other edit (§11's "everything goes through one unified history mechanism, no special-casing per action type").

---

## 12. Export

### `POST /projects/{id}/export`

Body:
```json
{
  "ecs": { "segments": [ "... same shape as GET /ecs ..." ] },
  "style": { "presetId": "uuid", "overrides": { "...": "same shape as GET /style" } }
}
```

**Why export carries the whole documents, not just a project id:** architecture doc §6 says the backend receives `CaptionStyleSpec` "when the user explicitly saves *or exports*" — treating export as its own trigger for transmitting the whole object, not something that silently trusts whatever was last saved. Read literally: hitting Export without a preceding explicit Save should still export exactly what's on screen, not stale backend state. So this endpoint **persists both documents as a side effect** (same validation as `PUT /ecs` / `PUT /style` — one validation path, not two that can drift apart) and *then* enqueues the export job — one call does what would otherwise be three (`PUT /ecs`, `PUT /style`, `POST /export`) with a window in between for the second `PUT` to fail or race. This is an interpretation of §6's wording, not something stated unambiguously — flagged again in §13.

**202** → `Job` (`type: "export"`). Poll `GET /jobs/{id}`; once `status: "done"`, `result` carries the one output (architecture doc §2.5):

**Example — completed export job:**
```json
{
  "id": "1e6a1c1e-9c2b-4a3d-8f21-abc123456789",
  "project_id": "9f2b7e10-1234-4a3d-8f21-abc987654321",
  "owner_id": "00000000-0000-0000-0000-000000000001",
  "type": "export",
  "status": "done",
  "created_at": "2026-07-08T10:00:00Z",
  "updated_at": "2026-07-08T10:02:14Z",
  "error": null,
  "result": {
    "video_url": "/files/projects/9f2b7e10/exports/1e6a1c1e/video.mp4"
  }
}
```

These URLs come from the storage abstraction (architecture doc §2.1) — relative paths under local disk today, potentially signed cloud URLs later; the contract doesn't care which, by design.

### `POST /projects/{id}/export-srt`

Same body shape as `POST /projects/{id}/export` — `{ecs, style}`. Unlike `/export`, this endpoint does **not** persist either document: it validates the submitted `ecs`/`style` (same shared path as `PUT /ecs` / `PUT /style` / `POST /export`) and generates an SRT file from exactly what was submitted, discarding the body once the job is enqueued. This matters when the editor screen has unsaved edits — `/export-srt` reflects them without requiring a save first, and without writing them to the project.

**202** → `Job` (`type: "export_srt"`). Poll `GET /jobs/{id}`; once `status: "done"`:
```json
{ "result": { "srt_url": "/files/projects/9f2b7e10/exports/<job_id>/captions.srt" } }
```

**SRT export** loses word-level timing by construction — a known, accepted limitation, not a bug (architecture doc §2.5). ASS export (which would preserve it) has no endpoint here; it's still explicitly deferred (architecture doc §14 item 5).

**The internal project JSON bundle (`json_url`) has been removed** — it is no longer produced by any endpoint. (Previously bundled `ecs`+`style` as one portable snapshot alongside the video export; dropped from scope. If a re-import/portable-snapshot need resurfaces, it should be designed as its own endpoint against whatever that need actually requires, not reinstated as a side effect of video export.)


---

## 13. Architecture Doc §14 — Resolved / Still Open

| # | Question | Resolution in this contract |
|---|---|---|
| 1 | API endpoint structure | This document. |
| 2 | ECS/Style persistence granularity | Separate: `/ecs` and `/style`, two endpoints, two documents. |
| 3 | Document versioning | Not in MVP. No `version` field, no optimistic-concurrency check, last-write-wins on `PUT`. |
| 4 | Autosave | Still excluded from MVP; the same `PUT` endpoints support it later by being called more often — no contract change needed. |
| 5 | Subtitle export formats | Video (POST /export) and SRT (POST /export-srt) are separate, independently-triggerable outputs — SRT does not persist ecs/style. Internal JSON bundle removed (was: always all three per export). ASS still deferred — no endpoint. |
| 6 | Retokenization algorithm | Still deferred — irrelevant to this contract, since `PUT /ecs` just validates whatever `Word[]` arrives, regardless of how it was produced. |
| 7 | Per-word link to Raw Transcript | Still excluded. Confirmed at the wire level: Raw Transcript words carry no `id` (§6). |
| 8 | Empty-segment behavior | Frontend drops the segment as part of the word-deletion edit; backend rejects an empty segment defensively on `PUT /ecs` (§7). |
| 9 | Undo scope of Reset to Raw Transcript | Participates in the normal undo stack — enabled by Reset being non-persisting on the backend, exactly like Recalculate Groups (§11). |
| 10 | UI confirmation before Recalculate Groups | Still open — a frontend UX question with no contract impact. |
| 11 | Queue granularity beyond `transcribe`/`export` | Still just two today; the LLM smart re-splitter (arch §2.3/§5.3) runs inside the `transcribe` job rather than motivating a third queue — it blocks that job's completion either way, so a separate queue bought no real concurrency. Queue choice stays an internal detail behind the `Job` abstraction. |
| 12 | Payment/quota integration point | Still deferred. The natural insertion point is the top of `POST /projects/{id}/export`, before the job is enqueued — noted, not built. |
| 13 | Authentication mechanism | Still deferred. `owner_id` is present on every entity architecture doc §2.4 names, resolving to one placeholder value everywhere in the MVP. |
| — | `Word.id` lifecycle at retokenization | New item, raised during contract design. Explicitly left unspecified — see §7. No wire-format consequence either way. |

**New judgment calls in this document worth a second look** (not forced by the architecture doc the way most of the above is):
- **Preset+delta wire shape** (§8) — inferred, not re-derived from something written down.
- **`POST /projects` vs. `POST /projects/{id}/transcribe` as two separate calls**, rather than upload auto-triggering transcription (§4). Leaning toward **keeping them separate**: the retry-after-failure path (§4's 409 guard) needs an explicit trigger to call again regardless of what upload does, so merging the calls wouldn't remove the need for this endpoint — it would only add a combined-response shape to design and build for the first-call case alone. Not a forced conclusion; revisit if the two-call frontend flow turns out to be awkward in practice.
- **Export bundling `ecs`+`style` into its own request body and persisting them as a side effect** (§12) — a reading of architecture doc §6's "saves or exports" phrasing, not something stated unambiguously. Note this only applies to `POST /export`; `POST /export-srt` deliberately does not persist.

---

## 14. Infrastructure Notes (Non-Contract)

None of this changes an endpoint or a JSON shape beyond the rate-limit convention already fixed in §1. Recorded here so it isn't lost, and so Redis never quietly becomes authoritative for something the app database already owns.

**Redis — optional infrastructure component, added behind seams the architecture already has, not new ones:**

| Potential use | Sits behind | Notes |
|---|---|---|
| Cache (presets, job-status reads) | Data access layer (architecture doc §2.2) | Repository interface is unchanged; cache-aside lives inside the repository implementation. The app database stays authoritative — a cache miss just means "slower," never "wrong." |
| Rate limiting counters | API-layer middleware (§1) | Standard token-bucket backing store. Keyed by `owner_id` (§1), same as the `429` convention above. |
| Ephemeral job-status push | New — a poll→push channel for `GET /jobs/{id}` (raised earlier in this conversation as a genuine scaling win at high poll volume, distinct from the queue-count question) | Redis pub/sub carries "status changed" *notifications* only, to trigger a WebSocket/SSE push. It does not carry the status itself as something a client can trust on its own — the persisted row in the app database (architecture doc §2.3) is still what a client re-checks on reconnect. A dropped pub/sub message costs a UX delay until the next poll, never a wrong status. |
| Sessions | Integration/data access layer, once real auth (§13, item 13) lands | Not needed while `owner_id` resolves to one placeholder. |

**Not source of truth, anywhere, for anything** — the one invariant across all four uses above, and the thing that keeps Redis from reintroducing the "two divergent sources of truth" problem architecture doc §2.3 explicitly designed the job system to avoid. If Redis is unavailable, correctness degrades to "slower" (cache miss, fall through to the database) — never to "wrong" or "stuck."

**Nginx** — load-balances stateless FastAPI instances (architecture doc §2.2 already makes the service layer stateless, which is what makes this possible without touching business logic). Pure deployment topology; has no relationship to Celery worker concurrency in the `transcribe`/`export`/(future `split`) queues, which is tuned independently via worker process count per queue.

---

*End of API contract. Implements Caption Editor — Architecture Report in full; no section of that document is contradicted here.*