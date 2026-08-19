import { act, renderHook, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi, type Mock } from "vitest";
import type { ReactNode } from "react";

import type { CaptionStyleSpec, ECS } from "../api/client";
import { STR } from "../i18n";
import { PROJECT_ID, ecsFixture, styleFixture } from "../mocks/fixtures";
import { server } from "../mocks/server";
import { present } from "../test-utils";
import type { EditorDocument } from "./useEditorDocument";
import { useProjectSave } from "./useProjectSave";

const L = STR.en;

function LocationProbe(): JSX.Element {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {(location.state as { justSaved?: boolean } | null)?.justSaved ? "|justSaved" : ""}
    </div>
  );
}

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  return (
    <MemoryRouter initialEntries={["/projects/x"]}>
      {children}
      <LocationProbe />
    </MemoryRouter>
  );
}

interface FakeDocOptions {
  dirty?: boolean;
  styleDirty?: boolean;
  ecs?: ECS | null;
  styleSpec?: CaptionStyleSpec | null;
}

// Only the fields useProjectSave actually reads; the rest are spies so the test can assert what
// the save handed back to the document.
function fakeDoc({
  dirty = false,
  styleDirty = false,
  ecs = ecsFixture,
  styleSpec = styleFixture,
}: FakeDocOptions = {}): EditorDocument {
  return {
    ecs,
    styleSpec,
    presets: null,
    dirty,
    styleDirty,
    undoAvailable: false,
    redoAvailable: false,
    applyEdit: vi.fn(),
    commitSnapshot: vi.fn(),
    applyEcsSegments: vi.fn(),
    commitPendingEdit: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    acceptSavedEcs: vi.fn(),
    acceptSavedStyle: vi.fn(),
    commitSavePoint: vi.fn(),
    markCurrentAsSaved: vi.fn(),
  };
}

function setup(doc: EditorDocument) {
  return renderHook(() => useProjectSave({ projectId: PROJECT_ID, doc, strings: L }), { wrapper });
}

describe("useProjectSave", () => {
  it("saves nothing when the document is clean, and still shows the saved badge", async () => {
    let ecsPuts = 0;
    server.use(
      http.put("*/api/v1/projects/:projectId/ecs", () => {
        ecsPuts += 1;
        return HttpResponse.json(ecsFixture);
      })
    );
    const doc = fakeDoc();
    const { result } = setup(doc);

    await act(async () => {
      await result.current.handleSave();
    });

    expect(ecsPuts).toBe(0);
    expect(doc.commitSavePoint).not.toHaveBeenCalled();
    expect(result.current.justSaved).toBe(true);
    expect(result.current.saveError).toBeNull();
  });

  it("PUTs only the dirty half", async () => {
    let stylePuts = 0;
    server.use(
      http.put("*/api/v1/projects/:projectId/style", () => {
        stylePuts += 1;
        return HttpResponse.json(styleFixture);
      })
    );
    const doc = fakeDoc({ dirty: true });
    const { result } = setup(doc);

    await act(async () => {
      await result.current.handleSave();
    });

    expect(stylePuts).toBe(0);
    expect(doc.acceptSavedEcs).toHaveBeenCalled();
    expect(doc.acceptSavedStyle).not.toHaveBeenCalled();
    expect(doc.commitSavePoint).toHaveBeenCalled();
  });

  it("adopts the server's echo as the new save point, not what was sent", async () => {
    const segment = present(ecsFixture.segments[0], "fixture segment");
    const serverEcho: ECS = {
      ...ecsFixture,
      segments: [{ ...segment, words: [present(segment.words[0], "first word")] }],
    };
    server.use(http.put("*/api/v1/projects/:projectId/ecs", () => HttpResponse.json(serverEcho)));
    const doc = fakeDoc({ dirty: true });
    const { result } = setup(doc);

    await act(async () => {
      await result.current.handleSave();
    });

    expect(doc.acceptSavedEcs).toHaveBeenCalledWith(serverEcho);
    const savePoint = present((doc.commitSavePoint as Mock).mock.calls[0], "commitSavePoint call")[0] as {
      segments: unknown;
    };
    expect(savePoint.segments).toEqual(serverEcho.segments);
  });

  it("surfaces a failed save and leaves the save point untouched", async () => {
    server.use(
      http.put("*/api/v1/projects/:projectId/ecs", () => new HttpResponse(null, { status: 422 }))
    );
    const doc = fakeDoc({ dirty: true });
    const { result } = setup(doc);

    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.saveError).toContain("422");
    expect(result.current.justSaved).toBe(false);
    expect(doc.commitSavePoint).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
  });

  it("go-home navigates with the justSaved flag once the save succeeded", async () => {
    const doc = fakeDoc({ dirty: true });
    const { result } = setup(doc);

    await act(async () => {
      await result.current.handleGoHome();
    });

    expect(screen.getByTestId("location")).toHaveTextContent("/|justSaved");
  });

  it("a failed save must not navigate away from unsaved work", async () => {
    server.use(
      http.put("*/api/v1/projects/:projectId/ecs", () => new HttpResponse(null, { status: 500 }))
    );
    const doc = fakeDoc({ dirty: true });
    const { result } = setup(doc);

    await act(async () => {
      await result.current.handleGoHome();
    });

    expect(screen.getByTestId("location")).toHaveTextContent("/projects/x");
    expect(result.current.saveError).toContain("500");
  });
});
