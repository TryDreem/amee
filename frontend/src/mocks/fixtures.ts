import type { components } from "../api/types.gen";

type Project = components["schemas"]["Project"];
type Job = components["schemas"]["Job"];
type RawTranscript = components["schemas"]["RawTranscript"];
type ECS = components["schemas"]["ECS"];
type CaptionStyleSpec = components["schemas"]["CaptionStyleSpec"];
type Preset = components["schemas"]["Preset"];

// Same placeholder owner_id the contract's own §12 example uses.
export const OWNER_ID = "00000000-0000-0000-0000-000000000001";
export const PROJECT_ID = "9f2b7e10-1234-4a3d-8f21-abc987654321";

const TRANSCRIBE_JOB_ID = "6a1c1e9c-2b4a-3d8f-8f21-abc123456700";
const EXPORT_JOB_ID = "1e6a1c1e-9c2b-4a3d-8f21-abc123456789";
const EXPORT_SRT_JOB_ID = "2f7b2d2f-0d3c-4b4e-9032-bcd234567890";
const PRESET_ID = "c1a1a1a1-0000-4000-8000-000000000001";
const SEGMENT_ID = "a0000000-0000-4000-8000-000000000001";
const WORD_ID_1 = "a0000000-0000-4000-8000-000000000002";
const WORD_ID_2 = "a0000000-0000-4000-8000-000000000003";

export const projectFixture: Project = {
  id: PROJECT_ID,
  owner_id: OWNER_ID,
  name: "Demo project",
  video_url: "/files/projects/9f2b7e10/source.mp4",
  language: "en",
  // Fixture represents a project whose transcribe job already finished
  // (arch §2.8) — non-null media fields, not the just-uploaded null state.
  thumbnail_url: "/files/projects/9f2b7e10/thumbnail.jpg",
  // video_height (1920) > 1080, so the real pipeline would have generated a
  // downscaled proxy rather than reusing video_url.
  preview_video_url: "/files/projects/9f2b7e10/proxy.mp4",
  video_width: 1080,
  video_height: 1920,
  video_duration_seconds: 12.5,
  created_at: "2026-07-08T10:00:00Z",
  updated_at: "2026-07-08T10:03:00Z",
  last_opened_at: "2026-07-08T10:04:00Z",
  latest_transcribe_job_id: TRANSCRIBE_JOB_ID,
  export_job_ids: [EXPORT_JOB_ID],
  // Mirrors exportJobFixture below (contract §4) -- same job id/url, kept as a literal here
  // since exportJobFixture is declared after this fixture.
  latest_export_job_id: EXPORT_JOB_ID,
  latest_export_url: "/files/projects/9f2b7e10/exports/1e6a1c1e/output.mp4",
};

export const transcribeJobFixture: Job = {
  id: TRANSCRIBE_JOB_ID,
  project_id: PROJECT_ID,
  owner_id: OWNER_ID,
  type: "transcribe",
  status: "done",
  // progress is only meaningful mid-processing (contract §5) — null once done.
  progress: null,
  // progress_percent is export-only, meaningful only while its ffmpeg step actually runs
  // (contract §5) — null here regardless (this is a transcribe job, and it's done).
  progress_percent: null,
  // Mirrors projectFixture.thumbnail_url once the probe/thumbnail branch
  // finishes, which it has here (status: done).
  thumbnail_url: "/files/projects/9f2b7e10/thumbnail.jpg",
  created_at: "2026-07-08T09:58:00Z",
  updated_at: "2026-07-08T09:59:30Z",
  error: null,
  result: null,
};

export const exportJobFixture: Job = {
  id: EXPORT_JOB_ID,
  project_id: PROJECT_ID,
  owner_id: OWNER_ID,
  type: "export",
  status: "done",
  progress: null,
  // Meaningful only while the ffmpeg step is actually running (contract §5) -- null once done.
  progress_percent: null,
  // Always null for type: export (contract §5) - thumbnail_url only ever
  // mirrors the transcribe job's probe/thumbnail branch.
  thumbnail_url: null,
  created_at: "2026-07-08T10:00:00Z",
  updated_at: "2026-07-08T10:02:14Z",
  error: null,
  result: {
    video_url: "/files/projects/9f2b7e10/exports/1e6a1c1e/output.mp4",
  },
};

// Separate job type on the same queue (contract §12, X6) — its result carries `srt_url` only,
// never `video_url`, which is what the client's result-narrowing has to get right.
export const exportSrtJobFixture: Job = {
  id: EXPORT_SRT_JOB_ID,
  project_id: PROJECT_ID,
  owner_id: OWNER_ID,
  type: "export_srt",
  status: "done",
  progress: null,
  progress_percent: null,
  thumbnail_url: null,
  created_at: "2026-07-08T10:00:00Z",
  updated_at: "2026-07-08T10:00:03Z",
  error: null,
  result: {
    srt_url: "/files/projects/9f2b7e10/exports/2f7b2d2f/captions.srt",
  },
};

export const rawTranscriptFixture: RawTranscript = {
  project_id: PROJECT_ID,
  owner_id: OWNER_ID,
  words: [
    { text: "Hello", start: 0.0, end: 0.4 },
    { text: "world", start: 0.4, end: 0.9 },
  ],
};

export const ecsFixture: ECS = {
  project_id: PROJECT_ID,
  owner_id: OWNER_ID,
  segments: [
    {
      id: SEGMENT_ID,
      words: [
        { id: WORD_ID_1, text: "Hello", start: 0.0, end: 0.4 },
        { id: WORD_ID_2, text: "world", start: 0.4, end: 0.9 },
      ],
    },
  ],
};

export const styleFixture: CaptionStyleSpec = {
  project_id: PROJECT_ID,
  owner_id: OWNER_ID,
  presetId: PRESET_ID,
  perPhraseStyle: false,
  overrides: {},
};

export const presetsFixture: Preset[] = [
  {
    id: PRESET_ID,
    name: "Bold Statement",
    default: true,
    base: {
      fontSize: 0.08,
      fontFamily: "Inter",
      fontWeight: 700,
      color: "#ffffff",
      highlightColors: ["#ffe600"],
      textTransform: "none",
      italic: false,
      glow: false,
      outline: null,
      shadow: null,
      showPunctuation: true,
      revealMode: "progressive",
      captionAnimation: "none",
      verticalPosition: 0.75,
      safeArea: { top: 0.1, bottom: 0.15 },
    },
    bounds: {
      fontSize: { min: 0.04, max: 0.12 },
      verticalPosition: { min: 0.1, max: 0.85 },
      safeArea: {
        top: { min: 0.05, max: 0.2 },
        bottom: { min: 0.05, max: 0.25 },
      },
    },
  },
];
