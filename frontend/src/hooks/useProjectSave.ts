import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, putEcs, putStyle } from "../api/client";
import type { Strings } from "../i18n";
import { snapshotOf } from "../lib/editSnapshot";
import type { EditorDocument } from "./useEditorDocument";

const SAVED_BADGE_MS = 2000;

interface UseProjectSaveArgs {
  projectId: string | undefined;
  doc: EditorDocument;
  strings: Strings;
}

export interface ProjectSave {
  saving: boolean;
  saveError: string | null;
  justSaved: boolean;
  handleSave: () => Promise<void>;
  handleGoHome: () => Promise<void>;
}

// Explicit save only (CLAUDE.md "Settled": whole-document PUT, no autosave on every edit).
export function useProjectSave({ projectId, doc, strings: L }: UseProjectSaveArgs): ProjectSave {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { ecs, styleSpec, dirty, styleDirty, acceptSavedEcs, acceptSavedStyle, commitSavePoint } = doc;

  // Shared by the Save button and "go home" (below): both need "persist whatever is dirty, then
  // do the thing" with identical error handling, so there's one save path instead of two that
  // could drift. Returns true when it's safe to proceed (saved, or there was nothing to save) —
  // false on a real failure, which the caller must NOT treat as "safe to navigate away from
  // unsaved work".
  const performSave = useCallback(async (): Promise<boolean> => {
    if (!projectId || !ecs || !styleSpec) {
      return true;
    }
    if (!dirty && !styleDirty) {
      return true;
    }
    setSaving(true);
    setSaveError(null);
    try {
      let nextEcs = ecs;
      let nextStyle = styleSpec;
      if (dirty) {
        nextEcs = await putEcs(projectId, ecs.segments);
        acceptSavedEcs(nextEcs);
      }
      if (styleDirty) {
        nextStyle = await putStyle(projectId, styleSpec.presetId, styleSpec.perPhraseStyle, styleSpec.overrides);
        acceptSavedStyle(nextStyle);
      }
      commitSavePoint(snapshotOf(nextEcs, nextStyle));
      return true;
    } catch (err) {
      setSaveError(err instanceof ApiError ? `${err.status}: ${err.message}` : L.saveFailed);
      return false;
    } finally {
      setSaving(false);
    }
  }, [projectId, ecs, styleSpec, dirty, styleDirty, acceptSavedEcs, acceptSavedStyle, commitSavePoint, L]);

  const handleSave = useCallback(async () => {
    if (saving) {
      return;
    }
    const ok = await performSave();
    if (ok) {
      setJustSaved(true);
      clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setJustSaved(false), SAVED_BADGE_MS);
    }
  }, [saving, performSave]);

  // Leaving the editor via the home icon (design: e_onGoHome) persists whatever is dirty first,
  // same as clicking Save, then navigates with a "just saved" flag the Home page reads once to
  // play the toast (design's sessionStorage flag, done via router state instead since this is one
  // SPA rather than two static pages). A failed save must NOT navigate away — that would silently
  // strand the user's edits behind a page they can no longer see, having just told them it worked.
  const handleGoHome = useCallback(async () => {
    if (saving) {
      return;
    }
    const ok = await performSave();
    if (ok) {
      navigate("/", { state: { justSaved: true } });
    }
  }, [saving, performSave, navigate]);

  return { saving, saveError, justSaved, handleSave, handleGoHome };
}
