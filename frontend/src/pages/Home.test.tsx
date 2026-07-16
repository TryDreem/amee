import { fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { projectFixture } from "../mocks/fixtures";
import { server } from "../mocks/server";
import Home from "./Home";

describe("Home", () => {
  it("shows the empty state, uploads a project, and returns to a populated list", async () => {
    server.use(http.get("*/api/v1/projects", () => HttpResponse.json([]), { once: true }));

    render(<Home />);

    expect(await screen.findByText("You don't have any projects yet")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Create first project"));
    expect(await screen.findByText("Drag video here")).toBeInTheDocument();

    const file = new File(["fake video bytes"], "clip.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByTestId("upload-file-input"), { target: { files: [file] } });

    expect(await screen.findByText(projectFixture.name)).toBeInTheDocument();
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
