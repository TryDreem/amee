import type { components } from "./types.gen";

export type Project = components["schemas"]["Project"];
export type Job = components["schemas"]["Job"];
export type RawTranscript = components["schemas"]["RawTranscript"];
export type ECS = components["schemas"]["ECS"];
export type Segment = components["schemas"]["Segment"];
export type Word = components["schemas"]["Word"];
export type CaptionStyleSpec = components["schemas"]["CaptionStyleSpec"];
export type Preset = components["schemas"]["Preset"];
export type PresetBase = components["schemas"]["PresetBase"];
export type StyleOverrides = components["schemas"]["StyleOverrides"];

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

// Project/Job media fields (video_url, thumbnail_url, preview_video_url, result.*_url) are
// root-relative paths served at the backend's origin (e.g. "/files/projects/..."), not under
// /api/v1 — resolve them against the API's origin, not the frontend's own.
export function resolveMediaUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  const origin = apiBase().replace(/\/api\/v1\/?$/, "");
  return `${origin}${path}`;
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

export async function getRawTranscript(projectId: string): Promise<RawTranscript> {
  return apiFetch<RawTranscript>(`/projects/${projectId}/raw-transcript`);
}

export async function getEcs(projectId: string): Promise<ECS> {
  return apiFetch<ECS>(`/projects/${projectId}/ecs`);
}

export async function getStyle(projectId: string): Promise<CaptionStyleSpec> {
  return apiFetch<CaptionStyleSpec>(`/projects/${projectId}/style`);
}

export async function listPresets(): Promise<Preset[]> {
  return apiFetch<Preset[]>("/presets");
}

// preset.base merged with the sparse CaptionStyleSpec.overrides — override wins per-field
// (contract §8-9). Never pre-merged server-side; the frontend resolves it.
export function resolveStyle(preset: Preset, overrides: StyleOverrides): PresetBase {
  return { ...preset.base, ...removeNullish(overrides) };
}

function removeNullish(overrides: StyleOverrides): Partial<PresetBase> {
  const result: Partial<PresetBase> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== null && value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}
