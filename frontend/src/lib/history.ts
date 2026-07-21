// Snapshot-based undo/redo (Step 7a, architecture §7 Behavior Matrix's last row). The whole
// project already treats ecs/style as whole documents swapped wholesale (whole-document PUT, no
// PATCH -- CLAUDE.md "Settled"), so a history of full-document snapshots is the design that
// matches everything else here, rather than a separate inverse operation per edit type.
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

// Oldest entries drop past this depth. An engineering default (no doc specifies a depth), chosen
// to bound memory for a long editing session without needing to be exact.
const MAX_DEPTH = 50;

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

// Records `history.present` as an undo point and moves to `next`. Always clears `future` -- a
// fresh edit after an undo discards the redo branch (standard undo/redo semantics).
export function push<T>(history: History<T>, next: T): History<T> {
  const past = [...history.past, history.present];
  if (past.length > MAX_DEPTH) {
    past.shift();
  }
  return { past, present: next, future: [] };
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) {
    return history;
  }
  const past = history.past.slice(0, -1);
  const present = history.past[history.past.length - 1] as T;
  return { past, present, future: [history.present, ...history.future] };
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) {
    return history;
  }
  const [present, ...future] = history.future as [T, ...T[]];
  return { past: [...history.past, history.present], present, future };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}
