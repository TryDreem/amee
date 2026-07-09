import { http, HttpResponse } from "msw";

import type { components } from "../api/types.gen";
import {
  ecsFixture,
  exportJobFixture,
  presetsFixture,
  projectFixture,
  rawTranscriptFixture,
  styleFixture,
  transcribeJobFixture,
} from "./fixtures";

type ECSPutBody = components["schemas"]["ECSPutBody"];
type CaptionStyleSpecPutBody = components["schemas"]["CaptionStyleSpecPutBody"];

export const handlers = [
  http.post("*/api/v1/projects", () => HttpResponse.json(projectFixture, { status: 201 })),

  http.get("*/api/v1/projects", () => HttpResponse.json([projectFixture])),

  http.get("*/api/v1/projects/:projectId", () => HttpResponse.json(projectFixture)),

  http.post("*/api/v1/projects/:projectId/transcribe", () =>
    HttpResponse.json(transcribeJobFixture, { status: 202 })
  ),

  http.get("*/api/v1/jobs/:jobId", ({ params }) =>
    HttpResponse.json(
      params.jobId === exportJobFixture.id ? exportJobFixture : transcribeJobFixture
    )
  ),

  http.get("*/api/v1/projects/:projectId/raw-transcript", () =>
    HttpResponse.json(rawTranscriptFixture)
  ),

  http.get("*/api/v1/projects/:projectId/ecs", () => HttpResponse.json(ecsFixture)),

  http.put("*/api/v1/projects/:projectId/ecs", async ({ request }) => {
    const body = (await request.json()) as ECSPutBody;
    return HttpResponse.json({ ...ecsFixture, segments: body.segments });
  }),

  http.get("*/api/v1/projects/:projectId/style", () => HttpResponse.json(styleFixture)),

  http.put("*/api/v1/projects/:projectId/style", async ({ request }) => {
    const body = (await request.json()) as CaptionStyleSpecPutBody;
    return HttpResponse.json({
      ...styleFixture,
      presetId: body.presetId,
      overrides: body.overrides,
    });
  }),

  http.get("*/api/v1/presets", () => HttpResponse.json(presetsFixture)),

  http.post("*/api/v1/projects/:projectId/recalculate-groups", () =>
    HttpResponse.json({ segments: ecsFixture.segments })
  ),

  http.post("*/api/v1/projects/:projectId/reset-to-raw", () =>
    HttpResponse.json({
      project_id: ecsFixture.project_id,
      owner_id: ecsFixture.owner_id,
      segments: ecsFixture.segments,
    })
  ),

  http.post("*/api/v1/projects/:projectId/export", () =>
    HttpResponse.json(exportJobFixture, { status: 202 })
  ),
];
