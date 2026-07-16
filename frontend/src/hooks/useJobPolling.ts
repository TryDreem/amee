import { useEffect, useState } from "react";

import { getJob, type Job } from "../api/client";

const POLL_INTERVAL_MS = 2000;

export interface UseJobPolling {
  job: Job | null;
  error: string | null;
}

export function useJobPolling(jobId: string | null): UseJobPolling {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setJob(null);
    setError(null);
    if (!jobId) {
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    async function poll(): Promise<void> {
      try {
        const result = await getJob(jobId as string);
        if (cancelled) {
          return;
        }
        setJob(result);
        if (result.status !== "done" && result.status !== "failed") {
          timeoutId = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to check job status.");
        }
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [jobId]);

  return { job, error };
}
