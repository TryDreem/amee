// @vitest-environment node
//
// jsdom's FormData/File globals aren't the same class undici's fetch checks
// via `instanceof`, which breaks multipart bodies under the default jsdom
// environment. This file has no DOM dependency, so run it under node instead.
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import {
  ecsFixture,
  exportJobFixture,
  exportSrtJobFixture,
  presetsFixture,
  projectFixture,
} from "../mocks/fixtures";
import { server } from "../mocks/server";
import {
  ApiError,
  createProject,
  exportProject,
  exportProjectSrt,
  exportSrtUrl,
  exportVideoUrl,
  listProjects,
  putEcs,
  resolveStyleLayers,
  type ExportPayload,
} from "./client";

describe("api client", () => {
  it("listProjects parses the fixture project list", async () => {
    const projects = await listProjects();
    expect(projects).toEqual([projectFixture]);
  });

  it("createProject sends multipart form data and parses the created project", async () => {
    let receivedFileName: FormDataEntryValue | null = null;
    let receivedName: FormDataEntryValue | null = null;
    server.use(
      http.post("*/api/v1/projects", async ({ request }) => {
        const formData = await request.formData();
        const uploadedFile = formData.get("file");
        receivedFileName = uploadedFile instanceof File ? uploadedFile.name : null;
        receivedName = formData.get("name");
        return HttpResponse.json(projectFixture, { status: 201 });
      })
    );

    const file = new File(["fake video bytes"], "clip.mp4", { type: "video/mp4" });
    const project = await createProject(file, "My clip");

    expect(project).toEqual(projectFixture);
    expect(receivedFileName).toBe("clip.mp4");
    expect(receivedName).toBe("My clip");
  });

  it("createProject omits language entirely when not given (auto-detect, contract §4)", async () => {
    let hasLanguageField = true;
    server.use(
      http.post("*/api/v1/projects", async ({ request }) => {
        const formData = await request.formData();
        hasLanguageField = formData.has("language");
        return HttpResponse.json(projectFixture, { status: 201 });
      })
    );

    const file = new File(["fake video bytes"], "clip.mp4", { type: "video/mp4" });
    await createProject(file);

    expect(hasLanguageField).toBe(false);
  });

  it("createProject sends a real language code unchanged, never the literal 'auto'", async () => {
    let receivedLanguage: FormDataEntryValue | null = null;
    server.use(
      http.post("*/api/v1/projects", async ({ request }) => {
        const formData = await request.formData();
        receivedLanguage = formData.get("language");
        return HttpResponse.json(projectFixture, { status: 201 });
      })
    );

    const file = new File(["fake video bytes"], "clip.mp4", { type: "video/mp4" });
    await createProject(file, undefined, "ru");

    expect(receivedLanguage).toBe("ru");
  });

  it("putEcs sends the whole segments array as JSON and parses the returned ECS", async () => {
    let receivedBody: unknown;
    server.use(
      http.put("*/api/v1/projects/:projectId/ecs", async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(ecsFixture);
      })
    );

    const result = await putEcs(ecsFixture.project_id, ecsFixture.segments);

    expect(result).toEqual(ecsFixture);
    expect(receivedBody).toEqual({ segments: ecsFixture.segments });
  });

  it("surfaces a non-2xx response as an ApiError with status and body", async () => {
    const validationError = {
      detail: [{ loc: ["query", "x"], msg: "field required", type: "value_error.missing" }],
    };
    server.use(
      http.get("*/api/v1/projects", () => HttpResponse.json(validationError, { status: 422 }))
    );

    const error = await listProjects().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).body).toEqual(validationError);
  });
});

describe("resolveStyleLayers (preset.base -> doc overrides -> segment overrides)", () => {
  const preset = presetsFixture[0];
  if (!preset) {
    throw new Error("presetsFixture is empty");
  }

  it("returns preset.base when both override layers are empty/absent", () => {
    expect(resolveStyleLayers(preset, {}, null)).toEqual(preset.base);
  });

  it("applies document overrides over the base, sparsely", () => {
    const merged = resolveStyleLayers(preset, { fontSize: 0.1 }, null);
    expect(merged.fontSize).toBe(0.1);
    expect(merged.fontFamily).toBe(preset.base.fontFamily); // untouched fields stay from base
  });

  it("applies the segment override on top of the document override (later layer wins)", () => {
    const merged = resolveStyleLayers(preset, { fontSize: 0.1, italic: true }, { fontSize: 0.2 });
    expect(merged.fontSize).toBe(0.2); // segment layer wins for fontSize
    expect(merged.italic).toBe(true); // doc-only field still applies
  });

  it("ignores the segment layer entirely when it is null (per-phrase off / no override)", () => {
    const merged = resolveStyleLayers(preset, { fontSize: 0.1 }, null);
    expect(merged.fontSize).toBe(0.1);
  });

  it("treats null/undefined fields inside an override as absent, not as a value", () => {
    const merged = resolveStyleLayers(preset, { fontSize: null }, { italic: undefined });
    expect(merged.fontSize).toBe(preset.base.fontSize);
    expect(merged.italic).toBe(preset.base.italic);
  });
});

describe("export", () => {
  const exportPreset = presetsFixture[0];
  if (!exportPreset) {
    throw new Error("presetsFixture is empty");
  }

  const payload: ExportPayload = {
    segments: ecsFixture.segments,
    presetId: exportPreset.id,
    perPhraseStyle: false,
    overrides: { fontSize: 0.1 },
  };

  const expectedBody = {
    ecs: { segments: ecsFixture.segments },
    style: { presetId: exportPreset.id, perPhraseStyle: false, overrides: { fontSize: 0.1 } },
  };

  // Both endpoints share ExportRequestBody verbatim (contract §12) — the body must carry the
  // whole ecs+style, since export renders what's on screen, not what was last saved.
  it("exportProject posts the whole ecs+style and returns the export job", async () => {
    let body: unknown;
    server.use(
      http.post("*/api/v1/projects/:projectId/export", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(exportJobFixture, { status: 202 });
      })
    );

    const job = await exportProject(projectFixture.id, payload);

    expect(body).toEqual(expectedBody);
    expect(job.type).toBe("export");
  });

  it("exportProjectSrt hits /export-srt with the same body shape", async () => {
    let body: unknown;
    let path = "";
    server.use(
      http.post("*/api/v1/projects/:projectId/export-srt", async ({ request }) => {
        body = await request.json();
        path = new URL(request.url).pathname;
        return HttpResponse.json(exportSrtJobFixture, { status: 202 });
      })
    );

    const job = await exportProjectSrt(projectFixture.id, payload);

    expect(path.endsWith("/export-srt")).toBe(true);
    expect(body).toEqual(expectedBody);
    expect(job.type).toBe("export_srt");
  });

  // Job.result is a union keyed on job.type (contract §5/§12) — each reader must only see its
  // own url, never the other job's.
  it("narrows a finished job's result to the url its own type carries", () => {
    expect(exportVideoUrl(exportJobFixture)).toBe(
      "/files/projects/9f2b7e10/exports/1e6a1c1e/output.mp4"
    );
    expect(exportSrtUrl(exportJobFixture)).toBeNull();

    expect(exportSrtUrl(exportSrtJobFixture)).toBe(
      "/files/projects/9f2b7e10/exports/2f7b2d2f/captions.srt"
    );
    expect(exportVideoUrl(exportSrtJobFixture)).toBeNull();
  });

  it("returns null for a job that has no result yet (still running)", () => {
    const running = { ...exportJobFixture, status: "processing" as const, result: null };
    expect(exportVideoUrl(running)).toBeNull();
    expect(exportSrtUrl(running)).toBeNull();
  });
});
