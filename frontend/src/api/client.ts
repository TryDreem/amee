import type { components } from "./types.gen";

export type Project = components["schemas"]["Project"];
export type ProjectPage = components["schemas"]["ProjectPage"];
export type ProjectSort = components["schemas"]["ProjectSort"];
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
export type RevealMode = components["schemas"]["RevealMode"];
export type CaptionAnimation = components["schemas"]["CaptionAnimation"];
export type ExportResult = components["schemas"]["ExportResult"];
export type ExportSrtResult = components["schemas"]["ExportSrtResult"];

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
  // 204 (DELETE /projects/{id}, POST /projects/{id}/open) has no body -- .json() would throw
  // on the empty string.
  if (response.status === 204) {
    return undefined as T;
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

export interface ListProjectsParams {
  limit?: number;
  offset?: number;
  q?: string;
  sort?: ProjectSort;
}

// contract §4: limit defaults to 8, clamped server-side to 1..50 -- never rejected, so this
// never validates the value itself, just omits params the caller didn't set.
export async function listProjects(params: ListProjectsParams = {}): Promise<ProjectPage> {
  const query = new URLSearchParams();
  if (params.limit != null) query.set("limit", String(params.limit));
  if (params.offset != null) query.set("offset", String(params.offset));
  if (params.q) query.set("q", params.q);
  if (params.sort) query.set("sort", params.sort);
  const qs = query.toString();
  return apiFetch<ProjectPage>(`/projects${qs ? `?${qs}` : ""}`);
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

// Hard delete, no trash/recovery (contract §4, X8). 404 if the project doesn't exist. 409 if a
// transcribe job is still queued/processing -- unlike export, transcribe has no OS process the
// backend can signal to cancel (WhisperX runs in-process), so delete refuses outright rather
// than a partial/soft cancel; the caller surfaces this distinctly, not as a generic failure.
// A queued/processing export, by contrast, is auto-cancelled server-side before delete proceeds.
export async function deleteProject(projectId: string): Promise<void> {
  await apiFetch<undefined>(`/projects/${projectId}`, { method: "DELETE" });
}

// No body; updates Project.last_opened_at server-side (contract §4). Fire-and-forget from the
// caller's perspective -- nothing in the response to act on.
export async function openProject(projectId: string): Promise<void> {
  await apiFetch<undefined>(`/projects/${projectId}/open`, { method: "POST" });
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

// Both export endpoints take the identical body (contract §12 — `ExportRequestBody` is shared
// verbatim by the two): the whole ECS + style documents, so the render reflects exactly what's on
// screen rather than whatever happened to be saved last.
export interface ExportPayload {
  segments: Segment[];
  presetId: string;
  perPhraseStyle: boolean;
  overrides: StyleOverrides;
}

function exportRequestInit(payload: ExportPayload): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ecs: { segments: payload.segments },
      style: {
        presetId: payload.presetId,
        perPhraseStyle: payload.perPhraseStyle,
        overrides: payload.overrides,
      },
    }),
  };
}

// Burned-in video only (contract §12, X1). Persists the submitted ecs+style as a side effect
// (X5), so triggering an export also saves — the caller should treat the documents as saved.
export async function exportProject(projectId: string, payload: ExportPayload): Promise<Job> {
  return apiFetch<Job>(`/projects/${projectId}/export`, exportRequestInit(payload));
}

// SRT only (contract §12, X6). Deliberately does NOT persist: the submitted documents are used
// once and discarded, so this exports unsaved edits without writing them to the project.
export async function exportProjectSrt(projectId: string, payload: ExportPayload): Promise<Job> {
  return apiFetch<Job>(`/projects/${projectId}/export-srt`, exportRequestInit(payload));
}

// Video export only, never export_srt (contract §5 -- SRT generation is near-instant, not worth
// cancelling). Kills the ffmpeg process server-side (tracked PID, P8/X7) -- this actually stops
// the render, not a "just stop watching" placeholder. 202 with the Job, still `processing` at the
// instant of this call; the caller keeps polling for the `cancelled` transition like any other
// async action here. 409 if the job isn't queued/processing, or isn't type export.
export async function cancelExportJob(projectId: string, jobId: string): Promise<Job> {
  return apiFetch<Job>(`/projects/${projectId}/jobs/${jobId}/cancel`, { method: "POST" });
}

// `Job.result` is a union whose shape follows `job.type` (contract §5/§12). Narrow on the field
// that's actually present rather than trusting `type` — a type/result mismatch then reads as
// "no url yet" instead of silently handing back `undefined` as a string.
export function exportVideoUrl(job: Job): string | null {
  return job.result && "video_url" in job.result ? job.result.video_url : null;
}

export function exportSrtUrl(job: Job): string | null {
  return job.result && "srt_url" in job.result ? job.result.srt_url : null;
}

export type TerminalJobStatus = "done" | "failed" | "cancelled";

// `Job.status` has three terminal values (contract §5): "done"/"failed", and now "cancelled" too.
// One shared check so every poller/effect that asks "is this job still moving" agrees -- a status
// this list misses would poll forever. A type predicate, not a plain boolean, so call sites that
// use this as a guard get `status` narrowed to the three terminal values for free -- e.g. handing
// it straight to a component whose prop type is exactly `TerminalJobStatus`.
export function isTerminalJobStatus(status: Job["status"]): status is TerminalJobStatus {
  return status === "done" || status === "failed" || status === "cancelled";
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
