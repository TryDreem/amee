// @vitest-environment node
//
// jsdom's FormData/File globals aren't the same class undici's fetch checks
// via `instanceof`, which breaks multipart bodies under the default jsdom
// environment. This file has no DOM dependency, so run it under node instead.
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { projectFixture } from "../mocks/fixtures";
import { server } from "../mocks/server";
import { ApiError, createProject, listProjects } from "./client";

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
