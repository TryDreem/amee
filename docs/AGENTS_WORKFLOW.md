# Amee — Parallel Agent Workflow

How to run 2–3 Claude Code sessions on this repo at once without them fighting each other.

---

## 0. The two things worktrees do not solve

Git worktrees isolate **files**. They do not isolate:

- **Runtime resources** — ports 8000/5173, the RabbitMQ broker, the SQLite file, `.data/storage/`.
  Two agents running `make dev` will collide instantly. Solved by `scripts/wt-env.sh` (port slots).
- **Logical conflicts** — two agents making incompatible assumptions about the same interface.
  Merges cleanly, breaks at runtime. Solved by **shared seams frozen before parallel work starts**
  and by **path ownership**.

Both of those are the actual work of this document. Worktree creation itself is one flag.

---

## 1. Session topology

Run **2 implementation sessions by default. 3 is the ceiling.** Not because Claude Code can't do
more — because you are the reviewer and the merge point, and beyond three the review queue becomes
the bottleneck and merge conflicts start to dominate.

| Session | Where | Writes code? | Owns |
|---|---|---|---|
| **M — main** | main checkout, `main` branch | no | planning, review, merge, `docs/`, `Makefile`, CI |
| **B — backend** | `claude -w be-<task>` | yes | `backend/**` |
| **F — frontend** | `claude -w fe-<task>` | yes | `frontend/**` except `src/api/types.gen.ts` |
| **Q — quality** (phase 2+) | `claude -w qa-<task>` | yes | `tests/e2e/**`, `tools/**`, `layout/fixtures/**` |

Session M never writes application code. Its job is to hold the plan, run `arch-reviewer` on incoming
diffs, and merge. Keeping it read-only is what stops "I'll just fix it here" from producing a fourth
uncoordinated changeset.

**Never run two sessions on the same layer.** Two backend agents in two worktrees will both touch
`backend/app/services/` and you will spend the afternoon resolving conflicts in code neither of you
wrote.

### Starting a session

```bash
# once per repo, to accept the workspace trust dialog
claude

# then, in separate terminals / VS Code windows:
claude -w be-jobs      # → .claude/worktrees/be-jobs/  on branch worktree-be-jobs
claude -w fe-editor    # → .claude/worktrees/fe-editor/
```

First thing inside a fresh worktree:

```bash
scripts/wt-env.sh   # allocates a port slot, writes .env.local
make dev
```

`.worktreeinclude` copies gitignored **secrets** into new worktrees (`.env.secrets`). It deliberately
does **not** copy `.env.local` — that file is generated per worktree and carries this worktree's
ports. Copying it would hand every agent port 8000.

### Opening prompt for each session

Paste this, adapted:

> You are session **B (backend)**. Read `CLAUDE.md` and `docs/INVARIANTS.md` first.
> Your task: <one milestone item>.
> You own `backend/**` only. Do not touch `frontend/`, `docs/`, `Makefile`, `docker-compose.yml`,
> `.github/`, or lockfiles.
> Run `scripts/wt-env.sh` then `make dev` before you start. `make check` must pass before you commit.
> When the task is done, commit to this worktree's branch and open a PR with `gh pr create`. Do not
> merge.
> If anything in your task touches an item in the "Open" list of `docs/INVARIANTS.md`, stop and tell me.

---

## 2. Milestones — what runs sequentially, what runs in parallel

### M0 — Skeleton & seam · **strictly sequential, one session, on `main`**

This is the part people are tempted to parallelize and must not. M0 creates the files both later
agents depend on. Two agents writing them at once guarantees a conflict in the one place a conflict
is expensive.

- monorepo layout, `docker-compose.yml` (RabbitMQ), Makefile
- FastAPI boots, Vite boots
- **Pydantic models for every shape in `api-contract.md`** — Project, Job, RawTranscript, ECS,
  Segment, Word, CaptionStyleSpec, Preset, error envelope
- **all 10 endpoints registered, every one returning `501`**
- `make types`: `/openapi.json` → `openapi-typescript` → `frontend/src/api/types.gen.ts` (committed)
- MSW mock handlers with fixtures, behind `VITE_API_MOCK=1`
- CI: `make check` + contract-drift check
- `CLAUDE.md`, `.claude/`, `scripts/`

**Done when:** `docker compose up` gives you a browsable `/docs` with all ten endpoints, and the Vite
app renders against the mock. Nothing is implemented. The seam is frozen.

Why this earns its own phase: after M0, backend and frontend are decoupled by a **generated** type
file. The frontend cannot drift from the contract, because it never hand-writes the contract.

---

### M1 — Core · **2 sessions (B + F)**

**B — backend**
- `storage.py` abstraction; ffmpeg probe (width/height/duration) at upload
- repositories (SQLite), `owner_id` placeholder everywhere
- `POST /projects`, `GET /projects`, `GET /projects/{id}`
- Job model + Celery + `transcribe` queue; status written to the app DB
- WhisperX integration; Raw Transcript persisted immutably
- Initial Splitter (`Words[] → Segments[]`), running inside the transcribe job
- `POST /projects/{id}/transcribe` with the 409 guard
- `GET /jobs/{id}`, `GET /raw-transcript`, `GET /ecs`

**F — frontend**
- upload screen, project list, job polling
- video player + caption overlay (preview renderer, reading ECS + resolved style)
- `GET /presets`, style panel with preset+delta *(the wire shape is flagged open — use whatever M0
  froze and do not invent extensions)*
- undo/redo stack — one unified history, from day one, not retrofitted

F works entirely against MSW until B lands. Flip `VITE_API_MOCK=0` at the end of M1.

---

### M2 — Editing & export · **2–3 sessions (B + F, optionally Q)**

**B**
- `PUT /ecs` + all validation invariants V1–V5
- `GET/PUT /style`, bounds validated against the resolved preset
- `POST /recalculate-groups` and `POST /reset-to-raw` — non-persisting, polymorphic `200`/`202`
- `POST /export` — persists both docs, enqueues on the `export` queue
- export worker: SRT + internal JSON + ffmpeg/libass burn-in

**F**
- timeline editor: word-boundary drag with **clamping**, split, merge
- whole-phrase edit → retokenization *(algorithm is open — implement the simplest placeholder behind
  one function and label it)*
- Recalculate Groups button, Reset to Raw
- overflow detection: real text measurement, wrap-between-words, 2-line max, visual error state
- safe-area warning
- export flow + result download

**Q** *(only if you have review bandwidth for a third stream)*
- e2e tests against a real backend
- the render-parity harness — see §5. **Do not start this before the human signs off on the
  fixture-suite proposal.**

---

### M3 — Integration & parity · **single session**

Merge everything, run the parity harness across styles × fonts × resolutions, look at actual frames.
`architecture.md` §12 is not satisfied until you have looked at diffed frames.

---

## 3. Path ownership

Conflicts are prevented structurally, not by asking nicely.

| Path | Owner |
|---|---|
| `backend/**` | B |
| `frontend/**` | F |
| `frontend/src/api/types.gen.ts` | **generated** — nobody hand-edits |
| `tests/e2e/**`, `tools/**`, `layout/fixtures/**` | Q |
| `docs/architecture.md`, `docs/api-contract.md` | **nobody** — binding, read-only |
| `docs/`, `Makefile`, `docker-compose.yml`, `.github/**`, `.claude/**`, lockfiles | M only |

`.claude/hooks/guard-protected-paths.sh` blocks edits to the read-only and generated files
deterministically. The rest is convention plus review.

**Adding a dependency** is an M-session task, because it touches a lockfile. An agent that needs a
package asks for it; it does not `npm install`.

---

## 4. Merge protocol

1. Agent runs `make check` in its worktree. Red ⇒ no PR.
2. Agent commits, `gh pr create --fill --base main`.
3. CI runs `make check` + contract drift.
4. Session M runs the `arch-reviewer` subagent on the diff (`/agents` → or just ask: *"run
   arch-reviewer on this PR's diff"*). It checks against `docs/INVARIANTS.md` and reports violations
   with section refs.
5. **You** read the diff. A Claude review of Claude's code is a useful filter, not a gate. The gate is
   CI plus your eyes.
6. Merge. Squash.

**Merge order rule:** if a PR changes `/openapi.json`, the backend PR merges **first**. Then
`make types` on main, commit the regenerated file, then the frontend PR rebases onto it. Otherwise
the frontend PR carries a stale generated file and CI's drift check will (correctly) fail it.

**Rebase, don't merge, inside worktrees.** `git fetch origin && git rebase origin/main` before opening
the PR. Keeps the history readable and surfaces conflicts while the agent still has context.

After merge:
```bash
git worktree remove .claude/worktrees/be-jobs
scripts/wt-env.sh --gc     # frees the port slot
```

---

## 5. The parity harness (proposal — needs sign-off)

`architecture.md` §12 names preview-vs-export divergence as the largest correctness risk and leaves it
unvalidated. `api-contract.md` adds nothing that would catch it. Nothing in the current plan makes the
two renderers agree; both merely *intend* to.

Proposal, **not yet a decision**:

- `layout/fixtures/*.json` — a golden suite: `{ videoWidth, videoHeight, style, segment }` →
  `{ lines: string[][], boxes: [...] }`
- backend and frontend each run the suite as an ordinary unit test. Both must produce identical
  wrap decisions and identical pixel boxes.
- `tools/parity/` renders N (style × font × resolution) combos through libass and through a headless
  browser, and frame-diffs them. Runs in CI nightly, not per-PR.

This makes the "same rules described in prose for both" of §12 into "the same fixtures, verified".
It also gives Q an isolated, genuinely parallel workstream that touches nobody else's files.

Cost: the fixtures become a third seam that must be frozen before Q and F work in parallel on layout.

---

## 6. Cost and failure modes

- **Every parallel session multiplies token usage.** Three sessions is three times the burn, and the
  third one is usually reviewing rather than shipping.
- **Worktrees do not prevent logical conflict.** They prevent file conflict. If B changes a response
  shape and F assumed the old one, both branches merge cleanly and the app breaks. This is what M0's
  generated types and CI's drift check exist to catch.
- **Uncommitted work in the main checkout is invisible to worktrees.** Commit or stash before
  spawning sessions.
- **Stale worktrees leak port slots.** `scripts/wt-env.sh --gc` after every removal, or slots run out
  at ten.
- **Do not use agent teams here** (experimental, off by default, and teammates are *not* isolated in
  worktrees — they share a working directory). Separate sessions in separate worktrees is the boring,
  correct choice for this project.
- Subagents cannot answer permission prompts: a subagent that hits an `ask` rule gets a denial. Keep
  subagents read-only (`arch-reviewer`, `contract-checker`) and let the parent session do the writing.

---

## 7. GitHub

```bash
gh auth login                                   # Claude Code drives gh through Bash
gh repo create <you>/amee --private --source=. --push
```

Inside Claude Code, once:
```
/install-github-app
```
Installs the Claude GitHub App and (optionally) the Actions workflow + `ANTHROPIC_API_KEY` secret. You
need repo-admin. After that, `@claude` works in issue and PR comments, and
`.github/workflows/claude.yml` can run `/review` on every PR.

Branch protection on `main`, even solo:
- require a PR
- require the `check` status to pass

Two things worth knowing before you lean on it:
- GitHub Actions do not trigger on commits made by a GitHub App by default. If you want CI to run on
  Claude's own commits, use a custom App with `actions/create-github-app-token`.
- Set `--max-turns` and a job timeout in the workflow. A runaway review job is expensive and boring.

You do **not** need the GitHub MCP server for this. `gh` on the command line does everything the
workflow above requires and costs no context.
