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
  cancelExportJob,
  createProject,
  deleteProject,
  exportProject,
  exportProjectSrt,
  exportSrtUrl,
  exportVideoUrl,
  isTerminalJobStatus,
  listProjects,
  openProject,
  putEcs,
  resolveStyleLayers,
  type ExportPayload,
} from "./client";

describe("api client", () => {
  it("listProjects parses the fixture project page ({items, total}, contract §4)", async () => {
    const page = await listProjects();
    expect(page).toEqual({ items: [projectFixture], total: 1 });
  });

  it("listProjects sends limit/offset/q/sort as query params", async () => {
    const receivedUrls: URL[] = [];
    server.use(
      http.get("*/api/v1/projects", ({ request }) => {
        receivedUrls.push(new URL(request.url));
        return HttpResponse.json({ items: [projectFixture], total: 1 });
      })
    );
    await listProjects({ limit: 8, offset: 16, q: "demo", sort: "updated" });
    const [receivedUrl] = receivedUrls;
    if (!receivedUrl) {
      throw new Error("mock handler was never called");
    }
    const params = receivedUrl.searchParams;
    expect(params.get("limit")).toBe("8");
    expect(params.get("offset")).toBe("16");
    expect(params.get("q")).toBe("demo");
    expect(params.get("sort")).toBe("updated");
  });

  it("listProjects omits every query param when called with no arguments", async () => {
    const receivedUrls: URL[] = [];
    server.use(
      http.get("*/api/v1/projects", ({ request }) => {
        receivedUrls.push(new URL(request.url));
        return HttpResponse.json({ items: [projectFixture], total: 1 });
      })
    );
    await listProjects();
    const [receivedUrl] = receivedUrls;
    if (!receivedUrl) {
      throw new Error("mock handler was never called");
    }
    expect(receivedUrl.search).toBe("");
  });

  // contract §4/X8: hard delete, 204 no body. apiFetch must not choke trying to .json() an
  // empty response.
  it("deleteProject resolves on 204 with no body", async () => {
    server.use(
      http.delete("*/api/v1/projects/:projectId", () => new HttpResponse(null, { status: 204 }))
    );
    await expect(deleteProject(projectFixture.id)).resolves.toBeUndefined();
  });

  it("deleteProject surfaces 409 as an ApiError (a transcribe job is still active)", async () => {
    server.use(
      http.delete("*/api/v1/projects/:projectId", () => new HttpResponse(null, { status: 409 }))
    );
    const error = await deleteProject(projectFixture.id).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
  });

  it("deleteProject surfaces 404 as an ApiError (already gone)", async () => {
    server.use(
      http.delete("*/api/v1/projects/:projectId", () => new HttpResponse(null, { status: 404 }))
    );
    const error = await deleteProject(projectFixture.id).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
  });

  it("openProject resolves on 204 with no body", async () => {
    server.use(
      http.post("*/api/v1/projects/:projectId/open", () => new HttpResponse(null, { status: 204 }))
    );
    await expect(openProject(projectFixture.id)).resolves.toBeUndefined();
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

  // contract §5: "cancelled" joined "done"/"failed" as a third terminal status. Every
  // poller/effect that decides "is this job still moving" goes through this one function --
  // missing a terminal value here means a cancelled job gets polled forever.
  it("isTerminalJobStatus treats done/failed/cancelled as terminal, queued/processing as not", () => {
    expect(isTerminalJobStatus("done")).toBe(true);
    expect(isTerminalJobStatus("failed")).toBe(true);
    expect(isTerminalJobStatus("cancelled")).toBe(true);
    expect(isTerminalJobStatus("queued")).toBe(false);
    expect(isTerminalJobStatus("processing")).toBe(false);
  });

  it("cancelExportJob posts to the real cancel endpoint and returns the job", async () => {
    let path = "";
    server.use(
      http.post("*/api/v1/projects/:projectId/jobs/:jobId/cancel", ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json({ ...exportJobFixture, status: "cancelled" }, { status: 202 });
      })
    );

    const job = await cancelExportJob(projectFixture.id, exportJobFixture.id);

    expect(path).toBe(`/api/v1/projects/${projectFixture.id}/jobs/${exportJobFixture.id}/cancel`);
    expect(job.status).toBe("cancelled");
  });

  it("cancelExportJob surfaces 409 as an ApiError (job isn't queued/processing/export)", async () => {
    server.use(
      http.post("*/api/v1/projects/:projectId/jobs/:jobId/cancel", () => new HttpResponse(null, { status: 409 }))
    );

    const error = await cancelExportJob(projectFixture.id, exportJobFixture.id).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
  });
});
