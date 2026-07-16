import type { components } from "./types.gen";

export type Project = components["schemas"]["Project"];
export type Job = components["schemas"]["Job"];

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function apiBase(): string {
  const base = import.meta.env.VITE_API_BASE;
  if (!base) {
    throw new Error(
      "VITE_API_BASE is not set — run `make dev` (via scripts/wt-env.sh) so it's populated."
    );
  }
  return base;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    throw new ApiError(response.status, body);
  }
  return (await response.json()) as T;
}

export async function listProjects(): Promise<Project[]> {
  return apiFetch<Project[]>("/projects");
}

export async function createProject(file: File, name?: string): Promise<Project> {
  const formData = new FormData();
  formData.append("file", file);
  if (name) {
    formData.append("name", name);
  }
  return apiFetch<Project>("/projects", { method: "POST", body: formData });
}

export async function getProject(projectId: string): Promise<Project> {
  return apiFetch<Project>(`/projects/${projectId}`);
}

// A 409 means a transcribe job already exists for this project (queued/processing/done) —
// callers should treat it as "already in progress", not a hard failure (api-contract §4).
export async function transcribeProject(projectId: string): Promise<Job> {
  return apiFetch<Job>(`/projects/${projectId}/transcribe`, { method: "POST" });
}

export async function getJob(jobId: string): Promise<Job> {
  return apiFetch<Job>(`/jobs/${jobId}`);
}
