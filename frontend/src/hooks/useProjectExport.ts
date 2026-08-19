import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";

import {
  isTerminalJobStatus,
  resolveMediaUrl,
  type ExportPayload,
  type Job,
  type Project,
} from "../api/client";
import { useExport, type ExportRecord } from "../contexts/ExportContext";
import type { Strings } from "../i18n";
import { triggerDownload } from "../lib/download";
import type { EditorDocument } from "./useEditorDocument";

interface UseProjectExportArgs {
  projectId: string | undefined;
  project: Project | null;
  setProject: Dispatch<SetStateAction<Project | null>>;
  doc: EditorDocument;
  strings: Strings;
}

export interface ProjectExport {
  record: ExportRecord | undefined;
  job: Job | undefined;
  pollError: string | undefined;
  kind: "video" | "srt" | null;
  starting: boolean;
  error: string | null;
  // An export is in flight from the click until the polled job reaches done/failed.
  busy: boolean;
  // Drives the Export button's spinner+reopen behavior specifically -- narrower than `busy`
  // (which also covers the brief POST-in-flight window and the SRT kind) because a
  // finished-but-undismissed video record (done/failed, modal or toast still showing) should NOT
  // spin the button forever.
  videoRunning: boolean;
  start: (kind: "video" | "srt") => Promise<void>;
  dismiss: () => void;
  returnToMenu: () => void;
  cancel: () => void;
  minimize: () => void;
  reopen: () => void;
}

// Deliberately NOT a second copy of ExportContext: starting the POST, polling, cancelling,
// minimize/reopen and the result-URL narrowing all stay in the context (they have to -- an
// export outlives this page). What lives here is only the part that is genuinely about *this*
// editor: building the payload out of the current document, handing the finished artifact to the
// user, patching Project.latest_export_url, and moving the save point after X5.
export function useProjectExport({
  projectId,
  project,
  setProject,
  doc,
  strings: L,
}: UseProjectExportArgs): ProjectExport {
  const navigate = useNavigate();
  const exportCtx = useExport();
  const { ecs, styleSpec, markCurrentAsSaved } = doc;

  // The context can hold records for other projects too (started from a different Editor visit),
  // which this page must ignore for its own busy/kind state.
  const record = exportCtx.records.find((r) => r.projectId === projectId);
  const job = record ? exportCtx.jobsById[record.id] : undefined;
  const pollError = record ? exportCtx.pollErrorsById[record.id] : undefined;
  const kind = record?.kind ?? null;

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which job has already been handed to the user. The completion effect below dismisses the
  // context record once handled, but that dismissal itself re-runs the effect one more time
  // before `record` goes away -- this makes handling a finished job idempotent per id.
  const handledJobRef = useRef<string | null>(null);

  const start = useCallback(
    async (nextKind: "video" | "srt") => {
      if (!projectId || !project || !ecs || !styleSpec || starting || record) {
        return;
      }
      setError(null);
      setStarting(true);
      const payload: ExportPayload = {
        segments: ecs.segments,
        presetId: styleSpec.presetId,
        perPhraseStyle: styleSpec.perPhraseStyle,
        overrides: styleSpec.overrides,
      };
      const result = await exportCtx.start(projectId, project.name, nextKind, payload);
      if (!result.ok) {
        setError(result.error);
      } else if (nextKind === "video") {
        // POST /export persists the submitted ecs+style as a side effect (X5), so the document on
        // the server now matches what's on screen — reflect that instead of leaving Save still
        // claiming unsaved changes. /export-srt deliberately does NOT persist (X6), so it must not
        // touch the save point.
        markCurrentAsSaved();
      }
      setStarting(false);
    },
    [projectId, project, ecs, styleSpec, starting, record, exportCtx, markCurrentAsSaved]
  );

  // ExportModal's exits. Continue-editing/Return-to-editor/Return-to-menu are all "stop watching,
  // keep the record dismissed" -- distinguished only by which phase they're reachable from and,
  // for Return-to-menu, whether they also navigate away.
  const dismiss = useCallback(() => {
    if (record) {
      exportCtx.dismiss(record.id);
    }
  }, [record, exportCtx]);

  const returnToMenu = useCallback(() => {
    dismiss();
    navigate("/");
  }, [dismiss, navigate]);

  // Step 11h: really stops the render (contract §5) -- unlike the other three exits, this does
  // NOT dismiss the record. Polling continues; once the job's status flips to "cancelled" the
  // modal shows its own dedicated cancelled screen, same as it already does for done/failed.
  const cancel = useCallback(() => {
    if (record) {
      void exportCtx.cancel(record.id);
    }
  }, [record, exportCtx]);

  const minimize = useCallback(() => {
    if (record) {
      exportCtx.minimize(record.id);
    }
  }, [record, exportCtx]);

  const reopen = useCallback(() => {
    if (record) {
      exportCtx.reopen(record.id);
    }
  }, [record, exportCtx]);

  // Finished export job -> hand the artifact to the user, then clear the job so the poller stops
  // and a new export can start. `result` is a union keyed on job type, so the url is read through
  // the matching narrowing helper rather than by indexing a field that may not be there.
  useEffect(() => {
    if (!job || !record || !isTerminalJobStatus(job.status)) {
      return;
    }
    if (handledJobRef.current === job.id) {
      return;
    }
    handledJobRef.current = job.id;
    if (job.status === "done") {
      const url = kind === "srt" ? exportCtx.srtUrl(job) : exportCtx.videoUrl(job);
      if (url) {
        const filename = kind === "srt" ? "captions.srt" : "video.mp4";
        // Project.latest_export_url (contract §4) is the persistent source of truth for "the
        // last export," video only (never export_srt) -- patched in locally so the header's
        // download-last-export icon appears immediately, without a re-fetch and without a
        // separate ad-hoc "just finished" state duplicating the same thing.
        if (kind === "video") {
          setProject((prev) =>
            prev ? { ...prev, latest_export_job_id: job.id, latest_export_url: url } : prev
          );
        }
        void triggerDownload(resolveMediaUrl(url), filename).catch(() => {
          // The download-last-export icon (video) / "Download srt file" in the ⋯ menu (srt)
          // remain the way to retry manually if the automatic attempt is blocked or fails.
        });
      } else {
        setError(L.exportFailed);
      }
    } else if (job.status === "failed") {
      setError(job.error ?? L.exportFailed);
    }
    // "cancelled" (contract §5): deliberately not an error (the human's own call) -- no error,
    // nothing to download. ExportModal/ExportToast render their own dedicated cancelled screen
    // straight off job.status; there's nothing for this effect to do beyond the guard above.
    // SRT has no modal (the modal only covers the video kind, matching the design -- the ⋯ menu's
    // SRT item was never wired into the design's export-modal system either), so nothing else will
    // ever dismiss its record -- do it here. A video record is deliberately left tracked: the
    // modal's own Done/Failed screen needs it to still exist so "Continue editing"/"Return to main
    // menu"/"Return to editor" have something to act on, instead of the record vanishing the
    // instant the job finishes.
    if (kind === "srt") {
      exportCtx.dismiss(record.id);
    }
    // `triggerDownload`/`L`/`exportCtx` are stable enough for this effect's purpose; re-running it
    // on every render would re-fire the download.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, kind, record]);

  return {
    record,
    job,
    pollError,
    kind,
    starting,
    error,
    busy: starting || record !== undefined,
    videoRunning:
      record?.kind === "video" &&
      job != null &&
      (job.status === "queued" || job.status === "processing"),
    start,
    dismiss,
    returnToMenu,
    cancel,
    minimize,
    reopen,
  };
}
