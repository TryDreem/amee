---
name: amee-arch-check
description: Check any proposed change to Amee against the binding architecture document before writing code. Use this skill whenever the task touches the data model, ECS, segments, words, timestamps, the splitter, Recalculate Groups, CaptionStyleSpec, the Layout Engine, overflow, safe area, fonts, undo/redo, jobs, queues, or any API endpoint — which is most tasks in this repo. Also use it when you are about to add a field, add an endpoint, add a validation rule, or make something happen automatically. Run it before implementing, not after.
---

# Amee architecture check

Amee's architecture was settled before any code existed, deliberately, so that implementation would
not renegotiate it one convenience at a time. This skill is how you avoid being the convenience.

## Authority

`references/architecture.md` (binding) > `references/api-contract.md` > `docs/INVARIANTS.md` > code.
(These are symlinks to `docs/architecture.md` and `docs/api-contract.md` — one file on disk, reachable
both ways. A `PreToolUse` hook blocks writes to both paths — you never edit them either way.)

These two documents are deliberately **not** in `CLAUDE.md` and not `@import`-ed anywhere. An
`@import` loads unconditionally into every session at launch, whether or not the task touches
architecture — for a 400+ line contract that is pure waste, every session, forever. Putting them
here instead means they load exactly when a task calls this skill, and not otherwise. That is the
whole reason this skill exists as a separate file rather than a section of CLAUDE.md.

## Before you write code

1. **Read `docs/INVARIANTS.md` first.** It is the short, pre-digested version — usually enough on
   its own for a routine change.
2. If INVARIANTS.md doesn't settle it -- the change is structural, or touches something INVARIANTS.md
   only summarizes -- **read the specific section** of `references/architecture.md` or
   `references/api-contract.md` via the Read tool. Don't read either document end to end; go to the
   section the task actually concerns (both have a table of contents with section numbers -- use it
   to jump straight there).
3. Name the invariants your change touches. Write them down in your response with their ids.
4. For each, state how your design satisfies it -- or that it doesn't, and stop.
5. Check the **Open** list at the bottom of INVARIANTS.md. If your task requires an answer to an open
   question: **stop and ask the human.** Do not choose. A default chosen by an agent is a decision
   nobody made, and it becomes load-bearing within a week.

## The four traps

These are not hypothetical. Each is a thing a competent engineer does by reflex, and each is wrong here.

**"I'll cache `segment.start` so the renderer doesn't recompute it."**
No. Segment bounds are derived, never stored (D5). A stored copy is a second thing to keep in sync
with every word edit, and it will drift. Derive it. It is one line.

**"The user changed the font size, so the grouping is stale — let me re-split."**
No. The splitter never receives `CaptionStyleSpec` (P4), so re-running it after a style-only change
is a no-op by construction (E4) — it would return the same segments while discarding the user's
manual split/merge decisions. And even after a *content* change, Recalculate Groups is user-triggered
only (E3). Never automatic. Not on save, not on blur, not on keystroke.

**"The text doesn't fit, so I'll shrink the font / split the segment automatically."**
No. Overflow produces a visual error state, and the user resolves it (L4). No auto-shrink, no
auto-split, no auto-truncate. The Layout Engine reads; it never writes (S2).

**"A 30ms word will flicker, so I'll add a minimum-duration validator."**
No. Minimum duration is explicitly a renderer concern, not a data-validation concern (V6). Server-side
validation is exactly V1–V5 and nothing else.

## Adding a field?

Ask: can this be derived from `Word[]`? If yes, derive it. The rule from arch §4.2 is absolute for
*computed* values — and equally absolute in the other direction for *authored* ones: segment
membership and segment order are user data, never recomputed (D7). Know which side you are on before
you add anything.

## If `references/architecture.md` looks empty or missing

Some zip extractors don't preserve symlinks. Run `scripts/link-arch-refs.sh` once -- it relinks both
reference files from `docs/`. If that script is also missing, just read `docs/architecture.md` and
`docs/api-contract.md` directly; the symlink is a convenience, not a requirement.

## Adding an endpoint?

Read `.claude/skills/amee-new-endpoint/SKILL.md` instead — it covers the layer walk and the tests.

## When you find a real conflict

Say it plainly, with the section reference, and stop:

> This contradicts architecture.md §5.2 — Recalculate Groups is never an automatic side effect.
> Implementing it would discard manual grouping decisions the user made. Do you want to revisit
> that decision, or should I do X instead?

Then wait. Do not implement both. Do not implement the contradiction with a comment apologizing for it.
