import { describe, expect, it } from "vitest";

import { canRedo, canUndo, initHistory, push, redo, undo } from "./history";

describe("history", () => {
  it("undo/redo round-trips through pushed states", () => {
    let h = initHistory(0);
    h = push(h, 1);
    h = push(h, 2);
    expect(h.present).toBe(2);

    h = undo(h);
    expect(h.present).toBe(1);
    h = undo(h);
    expect(h.present).toBe(0);

    h = redo(h);
    expect(h.present).toBe(1);
    h = redo(h);
    expect(h.present).toBe(2);
  });

  it("a new push after an undo clears the redo branch", () => {
    let h = initHistory(0);
    h = push(h, 1);
    h = push(h, 2);
    h = undo(h);
    expect(canRedo(h)).toBe(true);

    h = push(h, 99);
    expect(h.present).toBe(99);
    expect(canRedo(h)).toBe(false);
  });

  it("undo/redo on an empty stack is a no-op", () => {
    const h = initHistory(0);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it("caps history depth, dropping the oldest entry", () => {
    let h = initHistory(0);
    for (let i = 1; i <= 60; i++) {
      h = push(h, i);
    }
    expect(h.past.length).toBe(50);
    // The oldest surviving entry is 10 (0..9 dropped, since 60 pushes exceed the 50 cap by 10).
    expect(h.past[0]).toBe(10);
    let cur = h;
    for (let i = 0; i < 50; i++) {
      cur = undo(cur);
    }
    expect(cur.present).toBe(10);
    expect(canUndo(cur)).toBe(false);
  });

  it("canUndo/canRedo reflect stack state", () => {
    let h = initHistory("a");
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    h = push(h, "b");
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
    h = undo(h);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(true);
  });
});
