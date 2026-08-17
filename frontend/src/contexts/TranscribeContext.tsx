import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { getJob, isTerminalJobStatus, type Job } from "../api/client";

// Transcription used to be watched by Home's own `useJobPolling(jobId)`: the poll lived in the
// page, so the only place a running job was visible was the full-screen processing view, and
// leaving it (there was no way out anyway) stopped the watching entirely.
//
// This is the same shape ExportContext already uses for renders, for the same reason: a job the
// user started should keep being tracked while they go do something else, and should announce
// itself when it lands. Records are held in sessionStorage so a reload mid-transcription doesn't
// lose the thread either.
//
// Deliberately thinner than ExportContext: there is nothing to cancel (contract §4 — WhisperX has
// no OS process to signal, unlike an ffmpeg render), nothing to download, and no minimized/reopen
// state, because there is no modal — a finished transcription surfaces as a corner toast and
// nothing else.
export interface TranscribeRecord {
  id: string; // job id
  projectId: string;
  projectName: string;
}

const SESSION_KEY = "amee_transcribes";
const POLL_INTERVAL_MS = 2000;

function omitKey<T>(obj: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
}

function readRecords(): TranscribeRecord[] {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as TranscribeRecord[]) : [];
  } catch {
    return [];
  }
}

function writeRecords(records: TranscribeRecord[]): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(records));
  } catch {
    // Storage full/unavailable (private mode) -- tracking just won't survive a reload.
  }
}

interface TranscribeContextValue {
  records: TranscribeRecord[];
  jobsById: Record<string, Job>;
  pollErrorsById: Record<string, string>;
  // Starts watching an already-created transcribe job. The POST itself stays in the page: Home
  // has to handle the 409 "already transcribing" recovery path, which is about starting, not
  // about watching.
  track: (jobId: string, projectId: string, projectName: string) => void;
  // Stops watching. Called when the user acts on the result (opens the editor, closes the toast)
  // and when a retry supersedes the failed job it replaces.
  dismiss: (jobId: string) => void;
}

const TranscribeContext = createContext<TranscribeContextValue | null>(null);

export function TranscribeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [records, setRecords] = useState<TranscribeRecord[]>(() => readRecords());
  const [jobsById, setJobsById] = useState<Record<string, Job>>({});
  const [pollErrorsById, setPollErrorsById] = useState<Record<string, string>>({});
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const jobsRef = useRef(jobsById);
  jobsRef.current = jobsById;

  useEffect(() => {
    writeRecords(records);
  }, [records]);

  // One shared interval for every record that hasn't reached a terminal status yet, rather than
  // one interval per record.
  useEffect(() => {
    const timer = setInterval(() => {
      const pending = recordsRef.current.filter((r) => {
        const job = jobsRef.current[r.id];
        return !job || !isTerminalJobStatus(job.status);
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

  // Records restored from sessionStorage have no job snapshot yet -- fetch once immediately
  // instead of showing nothing for a full interval.
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

  const track = useCallback((jobId: string, projectId: string, projectName: string) => {
    setRecords((prev) =>
      prev.some((r) => r.id === jobId) ? prev : [...prev, { id: jobId, projectId, projectName }]
    );
    setPollErrorsById((prev) => omitKey(prev, jobId));
    // No job snapshot yet: the immediate fetch below is what fills the processing view before the
    // first interval tick, so the phase list isn't blank for two seconds after an upload.
    void getJob(jobId)
      .then((job) => setJobsById((prev) => ({ ...prev, [jobId]: job })))
      .catch(() => {
        /* the interval will retry */
      });
  }, []);

  const dismiss = useCallback((jobId: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== jobId));
    setJobsById((prev) => omitKey(prev, jobId));
    setPollErrorsById((prev) => omitKey(prev, jobId));
  }, []);

  const value: TranscribeContextValue = { records, jobsById, pollErrorsById, track, dismiss };

  return <TranscribeContext.Provider value={value}>{children}</TranscribeContext.Provider>;
}

export function useTranscribe(): TranscribeContextValue {
  const ctx = useContext(TranscribeContext);
  if (!ctx) {
    throw new Error("useTranscribe must be used within a TranscribeProvider");
  }
  return ctx;
}
