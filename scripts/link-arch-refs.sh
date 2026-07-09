#!/usr/bin/env bash
# Idempotently (re)link docs/architecture.md and docs/api-contract.md into the
# amee-arch-check skill's references/ folder.
#
# Why this exists: the skill keeps these two documents out of CLAUDE.md so they
# only load when a task actually needs them (see CLAUDE.md's @import note). It
# reaches them via references/ inside the skill folder. Symlinks survive a normal
# git clone or a POSIX unzip; they do NOT reliably survive every zip extractor
# (some Windows tools flatten symlinks into empty files). Run this once after
# cloning/extracting if `references/architecture.md` looks empty or missing.
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

for f in architecture.md api-contract.md; do
  test -f "docs/$f" || { echo "docs/$f not found -- copy your source doc there first" >&2; exit 1; }
done

mkdir -p .claude/skills/amee-arch-check/references
cd .claude/skills/amee-arch-check/references
ln -sf ../../../../docs/architecture.md architecture.md
ln -sf ../../../../docs/api-contract.md api-contract.md
echo "linked: references/architecture.md -> docs/architecture.md"
echo "linked: references/api-contract.md -> docs/api-contract.md"
