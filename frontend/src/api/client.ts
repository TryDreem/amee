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
export type OutlineOrShadow = components["schemas"]["OutlineOrShadow"];

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

// `language` is the caller's job to omit for "auto-detect" — this function never invents a
// sentinel value; a present `language` is sent through unchanged (contract §4: omitted/null
// means auto-detect, there is no wire-level "auto" string).
export async function createProject(
  file: File,
  name?: string,
  language?: string
): Promise<Project> {
  const formData = new FormData();
  formData.append("file", file);
  if (name) {
    formData.append("name", name);
  }
  if (language) {
    formData.append("language", language);
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

// Whole-document PUT (no PATCH) — segments is the entire ECS.segments, not a diff (CLAUDE.md
// "Settled": whole-document PUT). 422 means V1-V5 validation failed (contract §7).
export async function putEcs(projectId: string, segments: Segment[]): Promise<ECS> {
  return apiFetch<ECS>(`/projects/${projectId}/ecs`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segments }),
  });
}

export async function getStyle(projectId: string): Promise<CaptionStyleSpec> {
  return apiFetch<CaptionStyleSpec>(`/projects/${projectId}/style`);
}

export async function listPresets(): Promise<Preset[]> {
  return apiFetch<Preset[]>("/presets");
}

// Whole-document PUT, same pattern as putEcs — overrides is the entire sparse delta, not a
// diff against the previous save (contract §8).
export async function putStyle(
  projectId: string,
  presetId: string,
  perPhraseStyle: boolean,
  overrides: StyleOverrides
): Promise<CaptionStyleSpec> {
  return apiFetch<CaptionStyleSpec>(`/projects/${projectId}/style`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ presetId, perPhraseStyle, overrides }),
  });
}

// preset.base merged with the sparse CaptionStyleSpec.overrides — override wins per-field
// (contract §8-9). Never pre-merged server-side; the frontend resolves it.
export function resolveStyle(preset: Preset, overrides: StyleOverrides): PresetBase {
  return { ...preset.base, ...removeNullish(overrides) };
}

// The full three-layer merge for a single segment (architecture §4.2): the document-level style
// (preset.base + CaptionStyleSpec.overrides) with the segment's own `overrides` applied on top,
// each layer sparse and later-wins. `segOverrides` is null when the segment has no override, or
// when per-phrase mode is off (in which case segment overrides lie dormant, not applied). Preview
// and export MUST resolve a rendered segment through this exact function so they never disagree.
export function resolveStyleLayers(
  preset: Preset,
  docOverrides: StyleOverrides,
  segOverrides: StyleOverrides | null | undefined
): PresetBase {
  return {
    ...preset.base,
    ...removeNullish(docOverrides),
    ...(segOverrides ? removeNullish(segOverrides) : {}),
  };
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
