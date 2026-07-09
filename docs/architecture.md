# Caption Editor — Architecture Report
 
**Purpose of this document:** this is a self-contained architecture handoff. It captures the product idea, the full processing pipeline, the data model, and every architectural decision made so far — including the reasoning behind each decision, not just the conclusion. A developer or AI with no access to prior discussion should be able to read this and understand what to build and why, without needing clarification on anything that is already decided here. Open items that still need a decision are collected in a dedicated section at the end, not scattered through the text.
 
No API contract is defined yet. This document exists specifically to be finalized *before* the API contract is designed, so that the contract reflects settled architecture rather than being negotiated ad hoc.
 
---
 
## Table of Contents
 
1. [Product Overview & Strategy](#1-product-overview--strategy)
2. [Technology & Infrastructure Context](#2-technology--infrastructure-context)
3. [Full Pipeline](#3-full-pipeline)
4. [Data Model](#4-data-model)
5. [Segmentation](#5-segmentation)
6. [Separation of Style / Layout / Data](#6-separation-of-style--layout--data)
7. [Behavior Matrix](#7-behavior-matrix)
8. [Overflow & Layout Rules](#8-overflow--layout-rules)
9. [Safe Area & Positioning](#9-safe-area--positioning)
10. [Font System](#10-font-system)
11. [Undo / Redo](#11-undo--redo)
12. [Preview vs. Final Render Consistency](#12-preview-vs-final-render-consistency)
13. [Edge Cases](#13-edge-cases)
14. [Open Questions Before API Contract](#14-open-questions-before-api-contract)
 
---
 
## 1. Product Overview & Strategy
 
### 1.1 What the system does
 
The product is a captioning tool for short-form video. A user uploads a video; the system produces stylized, animated captions in the style popularized by tools like Submagic/CapCut — short phrases appearing in sync with speech, with the currently-spoken word highlighted. The user can preview the result, edit both the text/timing and the visual style, and then either:
 
- export a final video with captions burned in, or
- export the caption data (subtitle file + internal project data) for use elsewhere.
 
### 1.2 Product strategy: build for one user, don't close the door on a product
 
The system is being built for the creator's own use first, but deliberately **not** as a disposable script. The explicit decision was to architect it as if it may eventually have multiple users, without adding speculative complexity now. Concretely, this means: no unnecessary infrastructure is stood up today (no real user accounts, no cloud storage, no payments), but every seam where those things would plug in later is already present in the design — a storage abstraction instead of direct disk access, an owner/user field on every entity even though it always points at a single local pseudo-user today, a layered backend where swapping an implementation doesn't require touching business logic, and background job processing via a real queue instead of synchronous-only execution. The guiding rule throughout this document is: **decisions that are expensive to retrofit are made correctly now; decisions that are cheap to add later are deliberately deferred.**
 
### 1.3 Role of WhisperX, and why transcription runs exactly once
 
WhisperX is used for automatic speech recognition. Given an audio track, it returns a transcript with **word-level timestamps** — not just "this sentence was said between second 2 and second 4," but the start/end time of every individual word. This word-level timing is the foundation the entire captioning experience is built on: word highlighting, progressive word-by-word reveal, and manual timeline editing all depend on having a timestamp per word, not per sentence.
 
Transcription is treated as an expensive, one-time operation per video:
 
- It is the only step in the pipeline that involves a real ML model doing speech recognition.
- It is not deterministic-cheap to re-run — unlike everything downstream of it (splitting words into groups, applying a style, laying out text), which is fast, local, and safe to re-run as often as needed.
- Because of this cost asymmetry, the architecture is explicitly designed so that **no user edit ever triggers a second transcription pass.** Adding a word, deleting a word, correcting a misheard word, retiming a boundary, splitting or merging phrases — none of these call WhisperX again. They all operate on data that already exists locally.
 
### 1.4 Why the caption document becomes independent after transcription
 
Once WhisperX has produced its output (word list + timestamps) and an initial grouping into phrases has been generated from it, that result is copied into what this document calls the **Edited Caption Structure (ECS)** — and from that moment on, the ECS is treated as **the user's own document**, not as a live projection of the transcript.
 
This distinction matters because it resolves an entire class of "what happens if..." questions in one stroke: the original WhisperX output (called the **Raw Transcript**, see §4.1) is kept, untouched, purely as an archival fallback for a full project reset. Everything the user does — editing text, retiming words, adding/removing words, splitting or merging phrases — mutates the ECS only. There is no synchronization problem to solve between "what WhisperX said" and "what the user has now," because after the initial copy, the two are intentionally allowed to diverge, and nothing tries to reconcile them automatically.
 
---
 
## 2. Technology & Infrastructure Context
 
This section is scaffolding, not the core of the document — but it constrains the shape of the pipeline and data model described later, so it's included for completeness.
 
### 2.1 Stack
 
- **Backend:** Python + FastAPI. Chosen because the ML tooling required (WhisperX, ffmpeg orchestration) is native to the Python ecosystem.
- **Frontend:** React + TypeScript + Vite. Chosen as an industry-standard choice, partly with future hiring in mind if the project grows beyond a personal tool.
- **Database:** PostgreSQL from the MVP, not SQLite. Reasoning: owner_id/user_id is already reserved on every entity for future multi-user support (§2.4) — Postgres avoids a database migration exactly when real auth lands, matching the same "expensive to retrofit, made correctly now" rule as §1.2. SQLite's single-writer lock also doesn't fit well with Celery workers writing job status concurrently (§2.3) even at MVP scale.
- **File storage:** still local disk via storage.py — this axis is unaffected, only the DB choice changes.
 
### 2.2 Layered backend architecture
 
The backend is organized into four layers with strict responsibility boundaries, applied from day one even in the MVP:
 
| Layer | Responsibility |
|---|---|
| **API layer** (FastAPI routes) | Request/response validation only. No business logic. |
| **Service layer** | Orchestrates pipeline steps (extract → transcribe → split → style → export). Must be callable identically from an HTTP handler or from a background task — meaning its functions take and return plain, serializable data (ids, paths, primitives), never framework-specific request/response objects. |
| **Data access layer** | Repositories for videos, transcripts, jobs, caption documents, style presets. Hides the underlying storage technology (PostgreSQL from the MVP for structured data; local disk via storage.py for files, S3/R2 potentially later) from the service layer. |
| **Integration layer** | Wrappers around external tools/services: ffmpeg, WhisperX, and — later — a payment provider and the task queue. |
 
The reason for this separation: each of the "grow into a product" requirements below becomes a localized change instead of a rewrite, *because* the layers don't leak into each other.
 
### 2.3 Asynchronous processing: Celery + RabbitMQ, from the start
 
Unlike other product-readiness concerns, background job processing is **not deferred** — Celery with RabbitMQ is part of the MVP, not a future upgrade. Two separate queues are used from day one:
 
- `transcribe` — WhisperX transcription (and the initial segmentation step, see §5.1, which runs synchronously inside this same job since it's cheap).
- `export` — final rendering (burning captions into video via ffmpeg).
 
These are kept as two distinct queues because they have very different load profiles (ML inference vs. video encoding), and separating them now costs almost nothing but preserves the ability to scale or prioritize them independently later, without a migration.
 
**Job status is a first-class piece of data, not an implementation detail.** Every asynchronous operation is represented by a job with a status (`queued` / `processing` / `done` / `failed`), and this status lives in the application's own database — **not** in Celery's result backend. The worker process updates this status as it progresses. This avoids having two divergent sources of truth for "what's the state of this operation," which is a common failure mode when application code reads status from the queue system directly.
 
Because service-layer functions are written to take only serializable input (ids, paths, parameters) and never a framework request object, wrapping a call as a Celery task is a thin adapter, not a redesign.
 
### 2.4 Forward compatibility: auth and payments
 
- **Authentication:** every entity (project, transcript, caption document, export job) carries an `owner_id` / `user_id` field from the very first schema, even though in the MVP it always resolves to a single local placeholder user. This avoids a schema migration later — adding real authentication becomes "add a middleware that resolves a real user and stop hardcoding the placeholder," not "add ownership to every table."
- **Payments:** not implemented in the MVP, but the layered architecture anticipates it: a quota/subscription check is expected to sit at the service-layer boundary, immediately before expensive operations are kicked off (most obviously, export). Because the service layer is already the single choke point for orchestration, inserting this check later doesn't require touching the API layer or the data layer.
 
### 2.5 Export outputs (MVP)
 
Three outputs are produced per project, decided explicitly (see also §14 for the deferred alternative):
 
1. **Burned-in video** — captions rendered directly into the video file via ffmpeg.
2. **SRT file** — a widely compatible subtitle file, for import into third-party tools.
3. **Internal project JSON** — the full-fidelity project data (ECS + CaptionStyleSpec), for re-import into this same tool or for programmatic use.
 
A known limitation was explicitly acknowledged and accepted: standard SRT has no concept of word-level timing — it only supports phrase-level start/end. Since word-level highlighting is central to this product, exporting to plain SRT necessarily **loses** word-level timing data; the internal JSON is what preserves it. A richer subtitle format (ASS, which supports karaoke-style word timing and is the same format likely used internally as an intermediate step before the ffmpeg/libass burn-in render) was discussed and **deliberately deferred** — it can be added later as an additional export option without affecting anything else in the architecture.

### 2.6 Logging

Structured logging (JSON lines), written to stdout only — not to a file, not to a database. Docker
and Celery already capture stdout, so a separate log-storage pipeline is complexity with no MVP
payoff (same rule as §1.2: don't stand up infrastructure the single-user MVP doesn't need). If log
retention or search becomes necessary later, it's a collector configured outside the app (e.g. a
log-shipping sidecar) — the application code doesn't change, because it already writes to stdout.

Mechanism: not a decorator on every function — a middleware plus `contextvars`. The API layer sets
a `request_id` in a context variable at the start of each request. A logging filter reads whatever
context variables are set (`request_id`, `project_id`, `job_id`, `owner_id`) and attaches them to
every log line automatically, so a call like `logger.info("splitter ran", extra={"project_id": pid})`
doesn't need to pass `request_id` by hand. Celery tasks set `job_id` in the same way at task start —
there is no `request_id` inside a task, since no HTTP request is in flight there, and that's expected.

Log levels: `INFO` for pipeline stage transitions (job started/finished, WhisperX invoked, splitter
ran), `WARNING` for recoverable oddities (a validation retry, a slow ffmpeg probe), `ERROR` for
anything that sets `Job.status = "failed"`. Nothing more granular is needed for MVP.
 
---
 
## 3. Full Pipeline
 
```
Video
  |
  v
WhisperX                              (runs exactly once per video)
  |
  v
Raw Transcript
(words + absolute timestamps)         (immutable from this point on)
  |
  v
Initial Splitter                      (cheap, runs before any style exists)
  |
  v
Edited Caption Structure              (becomes the user's own document)
  |
  v
Frontend Editor
  |
  +-------------------------+
  |                         |
  v                         v
Style changes           Content changes
  |                         |
  v                         v
Layout Engine            Words[] updated
recalculation            (no re-transcription)
  |                         |
  v                         v
(no data mutation;      (optional, explicit)
 preview updated only)   Recalculate Groups
                             |
                             v
                         New Segments[]
                         (style untouched)
```
 
### Stage-by-stage explanation
 
1. **Video** — user provides a local video file (no cloud, no account, in the MVP).
2. **WhisperX** — audio is extracted (ffmpeg) and passed through WhisperX once. Output: every spoken word, with its text and its start/end timestamp. This is the single ML-dependent, non-trivially-expensive step in the whole pipeline.
3. **Raw Transcript** — the direct WhisperX output, persisted as an immutable artifact (§4.1). Never modified after creation; exists solely so the user can fully reset a project back to the original transcription if desired.
4. **Initial Splitter** — a fast, local, deterministic algorithm groups the flat word list into initial phrase-sized segments. This runs *before* any caption style has been chosen (§5.1) — an important constraint that shapes what this algorithm can and cannot know.
5. **Edited Caption Structure (ECS)** — the initial splitter's output becomes the first version of the ECS. From this point forward, the ECS is treated as the user's own mutable document; WhisperX is never invoked again for this project.
6. **Frontend Editor** — the user interacts with the video, the caption timeline, and style controls. Two categories of change are possible from here, and they are handled by entirely different mechanisms (§6, §7):
   - **Style changes** (font, size, color, position, preset, reveal mode, etc.) only ever trigger a **Layout Engine** recalculation. They never mutate the ECS.
   - **Content changes** (adding/removing/editing words) mutate the **Words[]** data directly, without re-transcription. They may optionally be followed by an explicit **Recalculate Groups** action (§5.2), which re-derives segment grouping from the current words — but this never happens automatically.
 
---
 
## 4. Data Model
 
### 4.1 Raw Transcript
 
- **Contents:** the flat list of words as returned by WhisperX, each with its text and its timestamp (start/end).
- **Mutability:** strictly immutable. It is written once, right after transcription, and never modified afterward.
- **Purpose:** exists solely as an archival fallback, to support a full "reset this project back to the original transcription" action (§13, case 7). It is not read or referenced during normal editing.
 
### 4.2 Edited Caption Structure (ECS) — the source of truth for editing
 
The ECS is the single mutable document that represents everything the user has done to the caption content. Its shape:
 
```
Edited Caption Structure
  └── Segment[]                (ordered list of phrase groups)
        ├── id                 (stable, not an array index)
        └── Word[]             (ordered list of words belonging to this segment)
              ├── id           (stable)
              ├── text
              ├── start        (absolute time, seconds from video start)
              └── end           (absolute time, seconds from video start)
```
 
**Important structural clarification:** a `Word` is *contained within* a `Segment` — it is not a separate, parallel top-level list that segments merely reference. The correct mental model is containment (`ECS → Segment[] → each Segment's Word[]`), not a two-stage pipeline where segments are computed and words are computed independently afterward. This was an early ambiguity in how the model was described and has since been corrected; this document reflects the corrected, final version.
 
#### Why word timestamps are absolute, not relative to their segment
 
Each word's `start`/`end` is measured from the beginning of the video, not from the start of its containing segment. This means the renderer never needs to add a segment offset to a word's time to know when it occurs — reducing arithmetic and the chance of an off-by-offset bug, especially important since the same timestamps are consumed by two independent renderers (preview and export, see §12).
 
#### Why segment start/end are computed, not stored
 
A `Segment` has no stored `start`/`end` fields. They are always derived: `segment.start = first word's start`, `segment.end = last word's end`. This is a deliberate application of a general rule used throughout the model: **any value that can be derived from the words must be derived, never stored redundantly** — because storing it separately creates a second place that must be kept in sync every time a word inside the segment is edited, added, or removed, and that synchronization would eventually drift. Both the preview renderer and the export renderer are required to compute this the same way, as part of the shared contract (same principle as CaptionStyleSpec interpretation, see §12).
 
#### Ordering invariant
 
Word order within a segment's array must match ascending order by `start` time. This is validated, not merely assumed.
 
#### Segment membership is an authored decision, not derived data
 
This is a refinement of the "derive, don't store" rule above, and it's worth stating explicitly because it initially reads as a contradiction: **which words belong to which segment, and in what order the segments appear, is *not* something recomputed on the fly.** It is decided once by the Initial Splitter, and from that point on it is part of the user's document, exactly like word text or word timing. The user can change it — via merge, split, reordering, or the explicit Recalculate Groups action (§5.2) — but nothing recalculates it silently as a side effect of some other change (most importantly: **not** as a side effect of a style change, see §6–§7).
 
So the "derive vs. store" rule splits along a precise line:
- **Derived, never stored:** a segment's start/end time (computed from its words).
- **Stored, authored, user-owned:** which words are grouped into which segment, and the order of segments and words.
 
#### Save semantics
 
The ECS is read and written as a **whole document** — there is no per-word or per-segment endpoint contract assumed. The frontend holds the live editing state (including the undo/redo history, §11) locally, and the full document is sent to the backend on save/export. This was a deliberate simplification: it keeps the contract simple now, and remains compatible with adding autosave later (calling the same "replace whole document" operation more frequently), without requiring a different contract shape (see §14).
 
#### Validation invariants (checked on save)
 
- Words within a segment do not overlap and are strictly ordered (`previous.end ≤ next.start`).
- Segments do not overlap each other (only one caption is visible at a time).
- A word's text is a non-empty string.
- `start < end` for every word. (Anything more sophisticated — e.g., a *minimum* duration to avoid visually-flickering ultra-short words — is explicitly treated as a **renderer** concern, not a data validation concern; see §8 and §13.)
 
#### Boundary editing behavior (word-to-word drag)
 
When the user drags the divider between two adjacent words in the timeline, both words' timestamps update together — the previous word's `end` and the next word's `start` move as one operation. The chosen behavior is **clamping**: neither word can be dragged past its neighbor's current boundary. An alternative — automatically pushing the neighbor's other boundary outward to make room — was considered and explicitly rejected for the MVP, because it produces less predictable editor behavior than a hard clamp.
 
#### No per-word link back to the Raw Transcript
 
Each `Word` does **not** carry a reference back to "the corresponding word in the Raw Transcript," and there is no `original`/`edited` flag. This was a deliberate MVP simplification: the Raw Transcript already provides a full-project reset path (§13, case 7), and a more granular "revert just this one word" feature was judged unnecessary for now. This is flagged in §14 as cheap to add later if it turns out to be wanted, but expensive to retrofit once a lot of editing history exists without it — so it's worth revisiting consciously rather than by accident.
 
#### New words and retiming
 
When a user inserts a new word, it is **not** sent through WhisperX or any re-alignment process. It receives an approximate timestamp computed by local editor logic, and the user can adjust it manually afterward via the timeline. A future, separate enhancement — a "re-align captions with audio" operation that would refine timestamps using the audio track — was discussed as a plausible later addition, but it is explicitly **out of scope** for the current data model and does not need to be designed for now; the model already accommodates it without change, since it would simply be another way of updating `Word.start`/`Word.end`.
 
#### Editing a whole phrase's text (retokenization)
 
When a user edits an entire segment's text as one block (rather than word-by-word), the segment's word list must be regenerated from the new text, and the available time budget (from the segment's original first-word-start to its original last-word-end) must be redistributed across the new words. **The exact redistribution algorithm is explicitly deferred** — not part of the MVP contract. A simple default (e.g., proportional to character length, or an even split) is acceptable to start with; this is called out as an implementation detail that can be swapped later without affecting the data model, since the output is still just an ordinary `Word[]` list.
 
---
 
## 5. Segmentation
 
### 5.1 Initial Splitter
 
- **When it runs:** synchronously, as part of the same `transcribe` background job, immediately after WhisperX produces the Raw Transcript. It does not need its own queue — it's a cheap, deterministic, local computation with no ML or video processing involved.
- **Why it runs before any style exists:** at this point in the pipeline, the user has not yet chosen a caption style or preset — that selection happens later, in the editor. This means the Initial Splitter **cannot** know the real font, font size, or safe-area width that will eventually be used, and therefore cannot make a pixel-accurate "will this fit on screen" decision. Its job is necessarily a coarse heuristic (e.g., a rough limit on words or characters per group) aimed at producing *readable* initial groupings — not at finding ideal semantic or visual boundaries. Precise fit-checking against a real style happens later, and separately, in the Layout Engine (§8).
- **Interface contract:** `Words[] → Segments[]`. Any splitter implementation — current or future — must conform to this same interface, so the model itself has no dependency on which algorithm produced the grouping.
 
### 5.2 Recalculate Groups
 
This is a user-triggered action, never an automatic side effect of anything.
 
- **What it does:** re-runs a splitting algorithm over the **current** `Words[]` (i.e., including every edit the user has made so far — added words, deleted words, edited text) and **replaces `Segments[]` entirely** with the new result.
 
  ```
  Current Words[]
        |
        v
     Splitter
        |
        v
   New Segments[]
  ```
 
- **What it explicitly does *not* touch:** `CaptionStyleSpec` is completely untouched — font, size, color, position, preset, reveal mode, and every other style setting persist exactly as they were. This is not a project reset and does **not** fall back to the Raw Transcript; it operates purely on the current, already-edited word list.
 
- **Why it's explicit, never automatic, after a style change:** style changes (§6, §7) never trigger this. In fact, running the splitter again after only a style change would be a **no-op by construction** — the splitter's interface never receives `CaptionStyleSpec` as input, so given an unchanged `Words[]`, it would deterministically produce the same `Segments[]` it already produced. There is nothing to gain by invoking it, and forcing it automatically would only be able to discard the user's manual grouping decisions for no benefit.
 
- **Why it's explicit, never automatic, after a content change:** even though a content change (adding/removing/editing words) *can* make the current grouping stale, re-splitting is still never triggered automatically — for example, not on every keystroke. The user decides when the current grouping no longer serves them and clicks the button. This preserves manual grouping decisions by default; automatic re-grouping is never sprung on the user as a side effect of typing.
 
- **Interaction with manual split/merge:** because Recalculate Groups fully replaces `Segments[]`, it will discard any manual split/merge decisions the user made previously, even if those decisions had nothing to do with the part of the text that changed. This is a known, accepted trade-off of the simple MVP approach; a UI confirmation before running it is a reasonable idea and is listed as an open UX question in §14, not yet a hard requirement.
 
- **Undo support:** Recalculate Groups is a normal, undoable mutation of `Segments[]`, and requires **no special-case handling** in the undo/redo system (§11) — it's simply another discrete state change in the same history stack as split, merge, or a text edit. Pressing undo immediately after Recalculate Groups restores the exact grouping that existed right before it ran.
 
### 5.3 Future splitter strategies
 
The splitter is architected as a replaceable strategy behind a fixed interface, not something the data model depends on:
 
```
Simple Splitter                       (MVP default)
      |
      +── Pause-based splitter        (uses silence/pause detection)
      |
      +── Punctuation splitter        (uses sentence/clause punctuation)
      |
      +── AI semantic splitter        (uses a language model for meaning-aware breaks)
```
 
All of these share the same `Words[] → Segments[]` contract. Only the internal algorithm changes; neither the Edited Caption Structure's shape nor any other part of the architecture needs to change to support swapping the strategy, or even offering the user a choice of strategy, later.
 
---
 
## 6. Separation of Style / Layout / Data
 
Three responsibilities are kept strictly separate, and no layer is allowed to reach into another's job:
 
- **Edited Caption Structure (Data)** answers: *which words exist, in what order, grouped into which segments.* This is "what to show, and when."
- **CaptionStyleSpec (Style)** answers: *font, size, weight, color, highlight behavior, vertical position, reveal mode* (whether a whole phrase appears at once with a moving highlight, or words appear progressively one at a time — see §7), and other purely visual settings, expressed as a base preset plus optional overrides (§ preset+delta model, established earlier in the project and unchanged here). This is "how to show it."
- **Layout Engine** answers: *given the data and the style, where does the text actually go on screen* — line wrapping, text measurement, safe-area application, final placement. This is "how to arrange it inside the frame." Critically, the **Layout Engine never mutates** the Edited Caption Structure or the CaptionStyleSpec — it only reads them and produces a rendering (or a "this doesn't fit" signal, see §8).
 
**Governing principle, stated exactly as agreed:**
 
> Data says what to show and when.
> Style says how to show it.
> Layout decides how to place it.
 
A practical consequence of this separation, made explicit in the project: **style edits live purely in frontend state while the user is adjusting them** (dragging a font-size slider, picking a color) — there is no backend round trip per change, and the preview updates instantly. The backend only receives the `CaptionStyleSpec` when the user explicitly saves or exports, at which point it is sent as a whole object — the same "read/write the whole document" pattern used for the Edited Caption Structure (§4.2).
 
---
 
## 7. Behavior Matrix
 
| Change | What actually changes | Trigger type |
|---|---|---|
| `fontSize` | Layout Engine recalculation only. `Segments[]`/`Words[]` untouched. | Automatic in live preview (frontend-only); backend only sees it on save/export. |
| `fontFamily` | Layout Engine recalculation only. | Automatic in live preview. |
| Color / weight / highlight color | `CaptionStyleSpec` value update only. No layout recomputation needed beyond re-render. | Automatic in live preview. |
| Vertical position | Layout Engine recalculation only (safe-area check applies). | Automatic in live preview. |
| Reveal mode (phrase-highlight vs. progressive) | `CaptionStyleSpec` value update only. | Automatic in live preview. |
| Preset switch | `CaptionStyleSpec` replaced with the new preset's base values; local overrides reset. | Explicit user action (choosing a preset). |
| Add a word | `Words[]` updated (new word with an approximate timestamp). | Immediate, part of normal content editing. |
| Delete a word | `Words[]` updated. | Immediate, part of normal content editing. |
| Edit a single word's text | `Words[]` updated (text only). | Immediate. |
| Edit a whole phrase's text | `Words[]` for that segment regenerated via retokenization (algorithm deferred, §4.2). | Immediate. |
| Drag a word boundary | Adjacent words' `start`/`end` updated together, clamped to neighbors. | Immediate. |
| Split a segment | `Segments[]` updated — words redistributed into two segments. | Explicit user action. |
| Merge two segments | `Segments[]` updated — words combined into one segment. | Explicit user action. |
| Recalculate Groups | `Segments[]` fully replaced by the splitter over current `Words[]`. `CaptionStyleSpec` untouched. | Explicit user action only — **never automatic**, regardless of whether the preceding change was to style or content (see §5.2 for why it would be a no-op after a style-only change anyway). |
| Undo / Redo | Reverts / reapplies whichever of the above was last applied, including Recalculate Groups. | Explicit user action (button or keyboard shortcut). |
 
---
 
## 8. Overflow & Layout Rules
 
### 8.1 Determining whether text fits
 
Whether a caption fits on screen **cannot** be determined from word count alone — it depends jointly on: the video's dimensions, the safe-area-derived available width, the font family, the font size, the font weight, and the actual text content. All of these must be taken into account by measuring the real rendered width of candidate text.
 
**Worked example from the design discussion**, illustrating the calculation shape (not a hardcoded constant): for a 1080×1920 video with an 85% safe horizontal width, the available width is `1080 × 0.85 = 918px`. The renderer measures the candidate line's rendered width against that figure to decide whether it fits, whether it needs to wrap, or whether it doesn't fit even after wrapping.
 
### 8.2 Line-wrap rules
 
- Wrapping may only occur **between words** — a word may never be split across a line break (e.g., `увлека-` / `ется` is explicitly forbidden).
- A caption block may use **at most 2 visual lines**. A grouping that would require a 3rd line to fit is treated as an overflow condition (§8.3), not resolved by allowing more lines.
 
### 8.3 What happens when text doesn't fit, even after wrapping to 2 lines
 
**No automatic data mutation occurs.** Specifically, none of the following happen automatically: font size is not auto-shrunk, the segment is not auto-split, and text is not auto-truncated. Instead, the editor enters a **visual error state** — the problematic caption block is flagged (e.g., highlighted or outlined in red, echoing the same "Canva-style" warning treatment used for safe-area violations in §9). The user is then responsible for choosing one of:
 
- reducing the font size,
- changing the style/preset,
- manually splitting the segment, or
- clicking **Recalculate Groups** (§5.2).
 
This rule applies identically regardless of *why* the overflow occurred — whether it's a fresh style change making previously-fitting text no longer fit, or a content edit (a newly added word) that made an existing grouping too long. The Layout Engine's job is only to detect and report overflow; resolving it is always a deliberate, user-initiated action.
 
---
 
## 9. Safe Area & Positioning
 
### 9.1 Horizontal positioning — center only (MVP)
 
Captions are horizontally centered, with **no support for arbitrary horizontal offset** in the MVP (no `x = 20%`/`80%` style positioning). This was a deliberate simplification, not an oversight, for three reasons: it's simpler to implement, it reduces the surface area where preview and export rendering could diverge (§12), and it produces consistent behavior across different video aspect ratios without needing per-format special-casing.
 
### 9.2 Vertical positioning — free within a safe zone
 
Vertical position is user-adjustable and stored as a value from `0.0` (top of video) to `1.0` (bottom of video), relative to video height:
 
```json
{ "verticalPosition": 0.75 }
```
 
A safe area restricts the valid range:
 
```json
{
  "safeArea": {
    "top": 0.1,
    "bottom": 0.15
  }
}
```
 
This means the top 10% and bottom 15% of the frame are off-limits for caption placement. If the user attempts to position a caption outside this range, the editor shows a visual warning (a red frame, the same "Canva-style" treatment referenced elsewhere in this document) rather than silently clamping or silently allowing it.
 
### 9.3 Where these bounds live
 
`safeArea` values and the valid range for `verticalPosition` are **part of `CaptionStyleSpec`/preset definitions**, not hardcoded global constants. This mirrors the same pattern used for font-size bounds (§10): different presets are allowed to define different safe-area and positioning constraints, rather than the whole system being locked to one fixed set of numbers.
 
---
 
## 10. Font System
 
- **Units:** font size is stored as a value **relative to video height**, not as an absolute pixel count — e.g., `{ "fontSize": 0.05 }` means 5% of video height. For a 1920px-tall video, that resolves to 96px. Relative units were chosen specifically to prevent preview and export from disagreeing across different video resolutions (the same underlying concern as relative units used elsewhere in the style spec).
- **Bounds are not a single global constant.** Rather than the system enforcing one hardcoded min/max (an earlier, since-revised idea was a flat 2%–10% range), the correct model is: each preset/`CaptionStyleSpec` defines its **own** default value plus its own min/max bounds. This allows different presets to have appropriately different ranges (a "bold statement" preset and a "dense subtitle" preset don't need to share the same limits), while still protecting against extreme, unusable values within any given preset.
- This default+bounds-per-preset pattern is intentionally reused for `safeArea` and `verticalPosition` (§9.3) — it's treated as a general pattern for style-scoped numeric properties, not a one-off rule for font size alone.
 
---
 
## 11. Undo / Redo
 
- **Entirely a frontend concern.** The backend has no concept of edit history whatsoever — it only ever persists whichever document state is explicitly sent to it (on save or export). There is no history endpoint and no expectation that the backend can reconstruct past states.
- **Implementation shape:** the frontend maintains an undo stack and a redo stack of document states (snapshots or diffs) as the user edits.
- **Keyboard shortcuts:** basic, standard shortcuts are expected — Cmd/Ctrl+Z for undo and Shift+Cmd/Ctrl+Z (or Cmd/Ctrl+Y) for redo. This is meant to cover the common baseline, not an exhaustive shortcut scheme.
- **Everything goes through one unified history mechanism** — there is no special-casing per action type. This explicitly includes:
  - text edits (single word or whole-phrase),
  - timing/boundary changes (dragging a word divider),
  - split,
  - merge,
  - **Recalculate Groups** — pressing undo immediately after a Recalculate Groups action must restore the exact `Segments[]` grouping that existed immediately beforehand,
  - style changes (font, size, color, position, preset, reveal mode, etc.).
 
  Because style edits live in the same frontend editing state as content edits (§6), they naturally fit into the same history stack without requiring a separate undo mechanism just for style.
 
---
 
## 12. Preview vs. Final Render Consistency
 
There are two independent rendering paths in this system:
 
1. **Browser preview** — a lightweight overlay rendered with CSS/Canvas directly over the `<video>` element, updated instantly and entirely client-side, with no backend involvement while the user is adjusting style or content.
2. **Backend export render** — the real, final render, performed via ffmpeg/libass, producing the burned-in output video.
 
**This is called out as the single largest correctness risk in the whole architecture.** These are two fundamentally different font-rendering and text-layout engines, built by different teams for different purposes — the fact that they *should* produce the same visual result is a design goal that must be actively engineered and validated, not an assumption that holds automatically just because both consume the same `CaptionStyleSpec`.
 
**What must be identical (or at least tightly matched) between the two:**
 
- interpretation of `CaptionStyleSpec` — the same units (relative font size, relative safe area, relative vertical position) must resolve to the same pixel values in both engines;
- the layout rules themselves — wrap-only-between-words, the 2-line maximum, safe-area math, center-only horizontal alignment, and the `verticalPosition`-to-pixel mapping;
- ideally, the actual line-wrapping *decision* logic — not just "the same rules described in prose for both," but code-level parity (the same algorithm, or a deliberately-matched port of it) wherever that's feasible, since subtle text-measurement differences between a browser and libass are a realistic source of divergence even when both sides are "following the same rule."
 
This has **not yet been validated in practice** — it is flagged as a known risk requiring a dedicated verification step (visually comparing preview output against actual rendered export output, across a range of styles, fonts, and resolutions) before the export path can be trusted, not something assumed solved by this document.
 
---
 
## 13. Edge Cases
 
| # | Scenario | Expected behavior |
|---|---|---|
| 1 | **Adding a new word** | `Words[]` is updated with an approximate timestamp from local editor logic. No re-transcription. `Segments[]` is left as-is unless the user explicitly runs Recalculate Groups. |
| 2 | **Deleting a word** | `Words[]` is updated (word removed). **Open question:** if this was the last remaining word in a segment, what happens to the now-empty segment? Not yet decided — see §14. |
| 3 | **Editing a long phrase** (replacing a whole segment's text at once) | The segment's `Words[]` is regenerated via retokenization (exact algorithm deferred, §4.2); the segment's computed start/end (§4.2) changes accordingly since it derives from the first/last word. |
| 4 | **`fontSize` change causing overflow** | No data mutation of any kind. The Layout Engine flags the block visually (§8.3). The user must act manually — shrink the font, change style, manually split, or Recalculate Groups. |
| 5 | **Recalculate Groups after user content edits** | `Segments[]` is replaced using the *current* (already-edited) `Words[]`. `CaptionStyleSpec` and all style settings are untouched. Any prior manual split/merge decisions are discarded by this operation (a UI confirmation before running it is a reasonable idea, not yet a settled requirement — §14). |
| 6 | **Undo immediately after Recalculate Groups** | Fully supported via the unified undo/redo stack (§11) — restores the exact `Segments[]` grouping from just before the action, no special-case logic required. |
| 7 | **Reset to Raw Transcript** | A full-project content reset: discards the current Edited Caption Structure entirely (all words, all grouping, all edits) and regenerates a fresh ECS by re-running the Initial Splitter over the untouched Raw Transcript. Does **not** affect `CaptionStyleSpec` — style is a separate object. **Open question:** should this action itself be a step inside the normal undo history, or should it be treated as a distinct "hard reset" outside of it? Not yet decided — see §14. |
 
---
 
## 14. Open Questions Before API Contract
 
These are the decisions intentionally left open by this document. None of them block understanding the architecture above, but all of them should be resolved (or consciously deferred with a stated default) before the API contract is finalized.
 
1. **API endpoint structure itself** — not yet designed; this document is the required precursor to that design.
2. **Persistence granularity:** should `CaptionStyleSpec` be saved together with the Edited Caption Structure as one combined "project state" document, or as two separate persisted objects behind two endpoints?
3. **Document versioning** — no scheme defined yet (relevant for future optimistic-concurrency handling on save, and for any future collaborative editing).
4. **Autosave** — explicitly excluded from the MVP, but the "read/write whole document" save pattern (§4.2, §6) was deliberately chosen so that adding autosave later means calling the same operation more frequently, not redesigning the contract.
5. **Subtitle export format(s):** MVP is confirmed as burned-in video + SRT + internal project JSON (§2.5). ASS export (which would preserve word-level timing in the exported subtitle file itself, unlike SRT) is explicitly deferred to a later addition, not required for MVP.
6. **Retokenization algorithm** for whole-phrase text edits (§4.2) — deferred; a simple default is acceptable for MVP and can be swapped later without changing the data model.
7. **Per-word link back to Raw Transcript** — explicitly excluded from MVP (§4.2); flagged as cheap to add now but more expensive to retrofit later, worth a conscious revisit rather than reconsidering it by accident.
8. **Empty-segment behavior:** what happens when the last word in a segment is deleted (edge case #2 in §13) — not yet decided.
9. **Undo scope of "Reset to Raw Transcript":** whether this hard-reset action participates in the normal undo stack or sits outside it (edge case #7 in §13) — not yet decided.
10. **UI confirmation before Recalculate Groups**, since it discards manual grouping decisions (§5.2, edge case #5 in §13) — flagged as a reasonable idea, not yet a settled requirement.
11. **Queue granularity beyond the current two queues** (`transcribe`, `export`) — no further subdivision has been considered; the current two-queue split (§2.3) is the only decision made so far.
12. **Payment/quota integration point** — architecturally anticipated as a service-layer boundary check before expensive operations (§2.4), but no quota model, pricing structure, or provider has been chosen.
13. **Authentication mechanism** — the data model reserves `owner_id`/`user_id` on every entity from day one (§2.4), but the actual auth mechanism (sessions, JWT, a specific provider) has not been chosen.
14. **Metrics/observability** — not part of the MVP. RabbitMQ's own management UI gives queue-level metrics (message counts, consumer counts) but nothing about application behavior (job duration,failure rate). If usage grows past single-user, a Prometheus/Grafana-style setup is the natural next step, and it slots in next to §2.6's logging module rather than replacing it — both would read from the same request_id/job_id context. Not needed to design now; flagged so it isn't forgotten.
 
---
 
*End of architecture report. Next step: design the API contract, using this document as the fixed set of constraints and decisions it must respect.*