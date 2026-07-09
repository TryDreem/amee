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
const PRESET_ID = "c1a1a1a1-0000-4000-8000-000000000001";
const SEGMENT_ID = "a0000000-0000-4000-8000-000000000001";
const WORD_ID_1 = "a0000000-0000-4000-8000-000000000002";
const WORD_ID_2 = "a0000000-0000-4000-8000-000000000003";

export const projectFixture: Project = {
  id: PROJECT_ID,
  owner_id: OWNER_ID,
  name: "Demo project",
  video_url: "/files/projects/9f2b7e10/source.mp4",
  video_width: 1080,
  video_height: 1920,
  video_duration_seconds: 12.5,
  created_at: "2026-07-08T10:00:00Z",
  latest_transcribe_job_id: TRANSCRIBE_JOB_ID,
  export_job_ids: [EXPORT_JOB_ID],
};

export const transcribeJobFixture: Job = {
  id: TRANSCRIBE_JOB_ID,
  project_id: PROJECT_ID,
  owner_id: OWNER_ID,
  type: "transcribe",
  status: "done",
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
  created_at: "2026-07-08T10:00:00Z",
  updated_at: "2026-07-08T10:02:14Z",
  error: null,
  result: {
    video_url: "/files/projects/9f2b7e10/exports/1e6a1c1e/output.mp4",
    srt_url: "/files/projects/9f2b7e10/exports/1e6a1c1e/captions.srt",
    json_url: "/files/projects/9f2b7e10/exports/1e6a1c1e/project.json",
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
      highlightColor: "#ffe600",
      revealMode: "progressive",
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
