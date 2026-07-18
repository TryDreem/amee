import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import UploadZone from "./UploadZone";
import type { Prefs } from "../theme";

const prefs: Prefs = { theme: "mono", mode: "dark", lang: "en" };

describe("UploadZone language picker", () => {
  it("defaults to auto-detect and omits it from onFileSelected's language when unchanged", () => {
    const onFileSelected = vi.fn();
    render(
      <UploadZone prefs={prefs} onBack={vi.fn()} onFileSelected={onFileSelected} busy={false} errorMessage={null} />
    );

    expect(screen.getByText("Auto detect")).toBeInTheDocument();

    const file = new File(["fake video bytes"], "clip.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByTestId("upload-file-input"), { target: { files: [file] } });

    expect(onFileSelected).toHaveBeenCalledWith(file, "auto");
  });

  it("opens the panel, selects a language, and passes its code through on upload", () => {
    const onFileSelected = vi.fn();
    render(
      <UploadZone prefs={prefs} onBack={vi.fn()} onFileSelected={onFileSelected} busy={false} errorMessage={null} />
    );

    fireEvent.click(screen.getByText("Auto detect"));
    const panel = screen.getByTestId("video-language-panel");
    fireEvent.click(within(panel).getByText("Russian"));

    expect(screen.getByText("Russian")).toBeInTheDocument();
    expect(screen.queryByTestId("video-language-panel")).not.toBeInTheDocument();

    const file = new File(["fake video bytes"], "clip.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByTestId("upload-file-input"), { target: { files: [file] } });

    expect(onFileSelected).toHaveBeenCalledWith(file, "ru");
  });
});
