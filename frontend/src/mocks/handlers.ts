import { http, HttpResponse } from "msw";

import type { components } from "../api/types.gen";
import {
  ecsFixture,
  exportJobFixture,
  exportSrtJobFixture,
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

  // contract §4: {items, total}, filtered by the case-insensitive `q` param -- a single-fixture
  // stand-in for the real search/pagination behavior. Tests that need more than one project or a
  // specific total override this handler directly (server.use), the established pattern here.
  http.get("*/api/v1/projects", ({ request }) => {
    const q = new URL(request.url).searchParams.get("q");
    const items =
      q && !projectFixture.name.toLowerCase().includes(q.toLowerCase()) ? [] : [projectFixture];
    return HttpResponse.json({ items, total: items.length });
  }),

  http.get("*/api/v1/projects/:projectId", () => HttpResponse.json(projectFixture)),

  // contract §4: 204 hard delete by default. Tests exercising the 409 (active transcribe job)
  // or 404 (already gone) paths override this via server.use.
  http.delete("*/api/v1/projects/:projectId", () => new HttpResponse(null, { status: 204 })),

  http.post("*/api/v1/projects/:projectId/open", () => new HttpResponse(null, { status: 204 })),

  http.post("*/api/v1/projects/:projectId/transcribe", () =>
    HttpResponse.json(transcribeJobFixture, { status: 202 })
  ),

  http.get("*/api/v1/jobs/:jobId", ({ params }) => {
    if (params.jobId === exportJobFixture.id) {
      return HttpResponse.json(exportJobFixture);
    }
    if (params.jobId === exportSrtJobFixture.id) {
      return HttpResponse.json(exportSrtJobFixture);
    }
    return HttpResponse.json(transcribeJobFixture);
  }),

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

  http.post("*/api/v1/projects/:projectId/export-srt", () =>
    HttpResponse.json(exportSrtJobFixture, { status: 202 })
  ),
];
