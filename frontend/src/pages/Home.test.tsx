import { fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { projectFixture, transcribeJobFixture } from "../mocks/fixtures";
import { server } from "../mocks/server";
import Home from "./Home";

describe("Home", () => {
  it("shows the empty state, then uploads and auto-transcribes through to a populated list", async () => {
    server.use(http.get("*/api/v1/projects", () => HttpResponse.json([]), { once: true }));

    render(<Home />);

    expect(await screen.findByText("You don't have any projects yet")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Create first project"));
    expect(await screen.findByText("Drag video here")).toBeInTheDocument();

    const file = new File(["fake video bytes"], "clip.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByTestId("upload-file-input"), { target: { files: [file] } });

    // auto-chained transcribe: the fixture job is already status "done", so polling
    // resolves it on the first check.
    expect(await screen.findByText("All done!")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Back to projects"));

    expect(await screen.findByText(projectFixture.name)).toBeInTheDocument();
    expect(screen.getByText("Create project")).toBeInTheDocument();
  });

  it("recovers from a 409 by polling the project's existing transcribe job", async () => {
    server.use(
      http.post(
        "*/api/v1/projects/:projectId/transcribe",
        () => HttpResponse.json({ detail: "already transcribing" }, { status: 409 }),
        { once: true }
      )
    );

    render(<Home />);
    await screen.findByText(projectFixture.name);

    fireEvent.click(screen.getByText("Create project"));
    const file = new File(["fake video bytes"], "clip.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByTestId("upload-file-input"), { target: { files: [file] } });

    // projectFixture.latest_transcribe_job_id already points at the (done) job fixture,
    // so the 409 fallback should find it and land on the same "done" state.
    expect(await screen.findByText("All done!")).toBeInTheDocument();
  });

  it("shows the real progress phase while processing, then completes", async () => {
    let pollCount = 0;
    server.use(
      http.get("*/api/v1/jobs/:jobId", () => {
        pollCount += 1;
        if (pollCount === 1) {
          return HttpResponse.json({ ...transcribeJobFixture, status: "processing", progress: "transcribing" });
        }
        return HttpResponse.json(transcribeJobFixture);
      })
    );

    render(<Home />);
    await screen.findByText(projectFixture.name);

    fireEvent.click(screen.getByText("Create project"));
    const file = new File(["fake video bytes"], "clip.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByTestId("upload-file-input"), { target: { files: [file] } });

    expect(await screen.findByText("Transcribing speech…")).toBeInTheDocument();
    // the hook polls every 2s — give the next real tick room to land.
    expect(await screen.findByText("All done!", {}, { timeout: 4000 })).toBeInTheDocument();
  }, 6000);

  it("shows a failed job with a retry action", async () => {
    server.use(
      http.get("*/api/v1/jobs/:jobId", () =>
        HttpResponse.json({ ...transcribeJobFixture, status: "failed", progress: null, error: "WhisperX crashed" })
      )
    );

    render(<Home />);
    await screen.findByText(projectFixture.name);

    fireEvent.click(screen.getByText("Create project"));
    const file = new File(["fake video bytes"], "clip.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByTestId("upload-file-input"), { target: { files: [file] } });

    expect(await screen.findByText("Something went wrong processing your video")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("WhisperX crashed");
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("surfaces an upload error and lets the user stay on the upload view", async () => {
    server.use(
      http.post(
        "*/api/v1/projects",
        () =>
          HttpResponse.json(
            { detail: [{ loc: ["body", "file"], msg: "unsupported format", type: "value_error" }] },
            { status: 422 }
          ),
        { once: true }
      )
    );

    render(<Home />);
    await screen.findByText(projectFixture.name);

    fireEvent.click(screen.getByText("Create project"));
    const file = new File(["fake video bytes"], "clip.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByTestId("upload-file-input"), { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("422");
    expect(screen.getByText("Drag video here")).toBeInTheDocument();
  });
});
