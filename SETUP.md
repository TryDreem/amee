# Setup — one time

## 0. One dependency to check

```bash
which jq || echo "install jq: apt install jq / brew install jq"
```

`.claude/hooks/guard-protected-paths.sh` needs it to block edits to `docs/architecture.md`,
`docs/api-contract.md`, and the generated `types.gen.ts`. Without `jq` the hook fails **closed**
(blocks all edits with a clear message) rather than silently doing nothing, but you still want it
installed before you start working.

## 1. Unzip into a new folder

```bash
mkdir amee && cd amee
unzip ~/Downloads/amee-claude-setup.zip -d .
# if it unzipped into amee/amee/... move the contents up one level
```

## 2. Drop in your two source documents

Save the two docs you already have (the ones you called "Project Documentation" and
"API Contract") as:

```
docs/architecture.md
docs/api-contract.md
```

Exact filenames, exact path. Everything else — CLAUDE.md, the skill, the hook — refers to them
by this path.

## 3. Link them into the skill

```bash
scripts/link-arch-refs.sh
```

This makes `.claude/skills/amee-arch-check/references/architecture.md` point at the file you just
saved, so the skill can read it on demand. If you ever move or rename the docs, rerun this script.

## 4. Init git, connect GitHub

```bash
git init
git add -A
git commit -m "project scaffold: CLAUDE.md, docs, skills, hooks, CI"

gh auth login                                   # once, if you haven't
gh repo create <your-username>/amee --private --source=. --push
```

## 4b. First push will show a red CI check — expected

`.github/workflows/ci.yml` runs `make check-backend` / `check-frontend`, which assume `backend/` and
`frontend/` exist. They don't yet — that's the next step (M0). GitHub will show the `check` run as
failing on this first commit. That's correct, not a misconfiguration: there's no code yet to check.
It goes green after M0 lands. If it bothers you, you can skip pushing until after M0, or push now and
ignore the red X for one commit.

## 5. Open Claude Code here

```bash
claude
```

First message, to sanity-check the setup before touching code:

> Read CLAUDE.md and docs/INVARIANTS.md. Summarize the pipeline in 5 lines and list the three
> invariants you'd break most easily if you weren't careful.

If it answers correctly and cites `docs/architecture.md` sections, the skill wiring works — it
had to go fetch that file on its own; it isn't sitting in CLAUDE.md.

## 6. Then, first real task — M0 (see docs/AGENTS_WORKFLOW.md)

> Set up the M0 skeleton: FastAPI backend, Vite+React+TS frontend, docker-compose for RabbitMQ,
> Pydantic models for every shape in docs/api-contract.md, all ten endpoints registered and
> returning 501, `make types` wired to generate frontend/src/api/types.gen.ts from the OpenAPI
> schema. Don't implement any endpoint logic yet. Use the amee-arch-check skill before you model
> anything.

Do this in the main checkout, not a worktree. It's the one phase that has to be sequential —
see AGENTS_WORKFLOW.md §2.

Everything after that — parallel sessions, worktrees, ports — is in `docs/AGENTS_WORKFLOW.md`.

---

## Why it's built this way (short version)

- **CLAUDE.md stays under 200 lines** because Claude Code loads it in full, every session,
  whether you need it or not. Long files there hurt adherence, not help it.
- **architecture.md / api-contract.md are NOT `@import`-ed.** `@import` also loads unconditionally
  at launch — same problem, just relocated. They live as `references/` files inside the
  `amee-arch-check` skill instead, which only loads when a task actually needs them.
- **The skill, not memory, is the mechanism for "always be able to check the architecture."**
  Claude decides per-task whether to consult it, based on the skill's description — which is
  written to trigger on basically anything touching the data model, pipeline, or API.
- **A hook, not a instruction, blocks edits to the two binding docs.** Instructions are followed
  probabilistically; hooks are shell commands that run regardless of what Claude decides.
