import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import {
  ApiError,
  exportProject,
  exportProjectSrt,
  exportSrtUrl,
  exportVideoUrl,
  getJob,
  type ExportPayload,
  type Job,
} from "../api/client";

// Step 11a: export tracking used to live in Editor.tsx's own useState -- gone the instant you
// navigated away, invisible to Home. The design's cross-page badge (Home shows a live ring+count
// for exports started from the Editor) needs this visible from, and startable/dismissible from,
// both pages at once. Persisted to sessionStorage under the same key name the design itself uses
// (a deliberate parallel, not a coincidence) so a full reload doesn't lose track of a running
// export either.
export interface ExportRecord {
  id: string; // job id
  projectId: string;
  projectName: string;
  kind: "video" | "srt";
}

const SESSION_KEY = "amee_exports";
const POLL_INTERVAL_MS = 2000;

function omitKey<T>(obj: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
}

function readRecords(): ExportRecord[] {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as ExportRecord[]) : [];
  } catch {
    return [];
  }
}

function writeRecords(records: ExportRecord[]): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(records));
  } catch {
    // Storage full/unavailable (private mode) -- tracking just won't survive a reload.
  }
}

interface ExportContextValue {
  records: ExportRecord[];
  jobsById: Record<string, Job>;
  pollErrorsById: Record<string, string>;
  // Resolves once the POST itself either succeeds (record is now tracked and polling) or fails
  // (nothing tracked) -- does NOT wait for the render job to finish.
  start: (
    projectId: string,
    projectName: string,
    kind: "video" | "srt",
    payload: ExportPayload
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  // Stops tracking/polling a record (minimized-and-finished dismissed, or a "stop watching"
  // cancel today -- see Step 11b, real cancel is Track 2/backend work not landed yet).
  dismiss: (recordId: string) => void;
  // Result URL helpers, kept here so callers don't need to re-import the narrowing functions.
  videoUrl: (job: Job) => string | null;
  srtUrl: (job: Job) => string | null;
}

const ExportContext = createContext<ExportContextValue | null>(null);

export function ExportProvider({ children }: { children: ReactNode }): JSX.Element {
  const [records, setRecords] = useState<ExportRecord[]>(() => readRecords());
  const [jobsById, setJobsById] = useState<Record<string, Job>>({});
  const [pollErrorsById, setPollErrorsById] = useState<Record<string, string>>({});
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const jobsRef = useRef(jobsById);
  jobsRef.current = jobsById;

  useEffect(() => {
    writeRecords(records);
  }, [records]);

  // One shared interval polls every record whose last known status isn't terminal yet, instead
  // of one interval per record -- there's normally at most one of these, but the shape (a list)
  // is what Home's "N active exports" badge needs, so it's built to hold more than one from the
  // start rather than retrofitted later.
  useEffect(() => {
    const timer = setInterval(() => {
      const pending = recordsRef.current.filter((r) => {
        const job = jobsRef.current[r.id];
        return !job || (job.status !== "done" && job.status !== "failed");
      });
      for (const rec of pending) {
        void getJob(rec.id)
          .then((job) => {
            setJobsById((prev) => ({ ...prev, [rec.id]: job }));
          })
          .catch((err: unknown) => {
            setPollErrorsById((prev) => ({
              ...prev,
              [rec.id]: err instanceof Error ? err.message : "Failed to check job status.",
            }));
          });
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  // Records restored from sessionStorage on mount have no job snapshot yet -- poll them
  // immediately once instead of waiting a full interval tick.
  useEffect(() => {
    for (const rec of recordsRef.current) {
      void getJob(rec.id)
        .then((job) => setJobsById((prev) => ({ ...prev, [rec.id]: job })))
        .catch(() => {
          /* the interval above will retry */
        });
    }
    // Intentionally once on mount only -- recordsRef/getJob/setJobsById are all stable.
  }, []);

  const start = useCallback(
    async (
      projectId: string,
      projectName: string,
      kind: "video" | "srt",
      payload: ExportPayload
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const job = kind === "srt" ? await exportProjectSrt(projectId, payload) : await exportProject(projectId, payload);
        const record: ExportRecord = { id: job.id, projectId, projectName, kind };
        setRecords((prev) => [...prev, record]);
        setJobsById((prev) => ({ ...prev, [job.id]: job }));
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof ApiError ? `${err.status}: ${err.message}` : "Export failed" };
      }
    },
    []
  );

  const dismiss = useCallback((recordId: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== recordId));
    setJobsById((prev) => omitKey(prev, recordId));
    setPollErrorsById((prev) => omitKey(prev, recordId));
  }, []);

  const value: ExportContextValue = {
    records,
    jobsById,
    pollErrorsById,
    start,
    dismiss,
    videoUrl: exportVideoUrl,
    srtUrl: exportSrtUrl,
  };

  return <ExportContext.Provider value={value}>{children}</ExportContext.Provider>;
}

export function useExport(): ExportContextValue {
  const ctx = useContext(ExportContext);
  if (!ctx) {
    throw new Error("useExport must be used within an ExportProvider");
  }
  return ctx;
}
