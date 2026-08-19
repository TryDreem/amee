import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Segment } from "../api/client";
import { PROJECT_ID, ecsFixture } from "../mocks/fixtures";
import { useEditorDocument } from "./useEditorDocument";

function renameFirstWord(segments: Segment[], text: string): Segment[] {
  return segments.map((s, i) =>
    i === 0 ? { ...s, words: s.words.map((w, j) => (j === 0 ? { ...w, text } : w)) } : s
  );
}

async function renderLoadedDocument() {
  const view = renderHook(() => useEditorDocument(PROJECT_ID));
  await waitFor(() => {
    expect(view.result.current.ecs).not.toBeNull();
  });
  return view;
}

describe("useEditorDocument", () => {
  it("loads the document and starts clean, with nothing to undo", async () => {
    const { result } = await renderLoadedDocument();

    expect(result.current.ecs?.segments).toEqual(ecsFixture.segments);
    expect(result.current.styleSpec).not.toBeNull();
    expect(result.current.presets).not.toBeNull();
    expect(result.current.dirty).toBe(false);
    expect(result.current.styleDirty).toBe(false);
    expect(result.current.undoAvailable).toBe(false);
    expect(result.current.redoAvailable).toBe(false);
  });

  it("marks a content edit dirty and undoable, and undo restores the exact saved state", async () => {
    const { result } = await renderLoadedDocument();

    act(() => {
      result.current.applyEcsSegments(renameFirstWord(ecsFixture.segments, "Goodbye"));
    });

    expect(result.current.ecs?.segments[0]?.words[0]?.text).toBe("Goodbye");
    expect(result.current.dirty).toBe(true);
    expect(result.current.undoAvailable).toBe(true);

    act(() => {
      result.current.undo();
    });

    expect(result.current.ecs?.segments[0]?.words[0]?.text).toBe("Hello");
    // The regression this guards: dirty is recomputed against the last-saved snapshot, never
    // toggled as a boolean, so undoing back to exactly the saved state must clear it.
    expect(result.current.dirty).toBe(false);
    expect(result.current.redoAvailable).toBe(true);
  });

  it("redo re-applies the undone edit", async () => {
    const { result } = await renderLoadedDocument();

    act(() => {
      result.current.applyEcsSegments(renameFirstWord(ecsFixture.segments, "Goodbye"));
    });
    act(() => {
      result.current.undo();
    });
    act(() => {
      result.current.redo();
    });

    expect(result.current.ecs?.segments[0]?.words[0]?.text).toBe("Goodbye");
    expect(result.current.dirty).toBe(true);
    expect(result.current.redoAvailable).toBe(false);
  });

  it("a style edit sets styleDirty, not dirty", async () => {
    const { result } = await renderLoadedDocument();

    act(() => {
      result.current.applyEdit({
        segments: ecsFixture.segments,
        presetId: result.current.styleSpec?.presetId ?? "",
        perPhraseStyle: false,
        overrides: { fontSize: 0.06 },
      });
    });

    expect(result.current.styleDirty).toBe(true);
    expect(result.current.dirty).toBe(false);
    expect(result.current.styleSpec?.overrides.fontSize).toBe(0.06);
  });

  it("coalesces a slider drag: live ticks don't push history, the commit folds them into one entry", async () => {
    const { result } = await renderLoadedDocument();
    const presetId = result.current.styleSpec?.presetId ?? "";

    // Three ticks of a drag -- each applies for a live preview, none touches history.
    for (const fontSize of [0.05, 0.06, 0.07]) {
      act(() => {
        result.current.commitSnapshot({
          segments: ecsFixture.segments,
          presetId,
          perPhraseStyle: false,
          overrides: { fontSize },
        });
      });
    }
    expect(result.current.styleSpec?.overrides.fontSize).toBe(0.07);
    expect(result.current.undoAvailable).toBe(false);

    act(() => {
      result.current.commitPendingEdit();
    });
    expect(result.current.undoAvailable).toBe(true);

    // One Undo steps back past the whole gesture, not one tick of it.
    act(() => {
      result.current.undo();
    });
    expect(result.current.styleSpec?.overrides.fontSize).toBeUndefined();
  });

  it("markCurrentAsSaved clears both dirty flags without discarding undo history", async () => {
    const { result } = await renderLoadedDocument();

    act(() => {
      result.current.applyEcsSegments(renameFirstWord(ecsFixture.segments, "Goodbye"));
    });
    act(() => {
      result.current.markCurrentAsSaved();
    });

    expect(result.current.dirty).toBe(false);
    expect(result.current.styleDirty).toBe(false);
    // X5 moves the save point, it isn't an edit -- the user can still undo past it.
    expect(result.current.undoAvailable).toBe(true);
  });

  it("commitSavePoint makes the saved snapshot the new clean baseline", async () => {
    const { result } = await renderLoadedDocument();

    const saved = {
      segments: renameFirstWord(ecsFixture.segments, "Goodbye"),
      presetId: result.current.styleSpec?.presetId ?? "",
      perPhraseStyle: false,
      overrides: {},
    };
    act(() => {
      result.current.applyEcsSegments(saved.segments);
    });
    act(() => {
      result.current.commitSavePoint(saved);
    });

    // Editing away from the save point dirties, coming back to it cleans -- both measured
    // against the new baseline, not the originally-loaded one.
    act(() => {
      result.current.applyEcsSegments(renameFirstWord(ecsFixture.segments, "Third"));
    });
    expect(result.current.dirty).toBe(true);

    act(() => {
      result.current.undo();
    });
    expect(result.current.dirty).toBe(false);
  });
});
