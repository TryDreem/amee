import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "./App";
import { projectFixture } from "./mocks/fixtures";

describe("App", () => {
  it("renders the logo and the real project list from the API", async () => {
    render(<App />);
    expect(screen.getByRole("img", { name: "Amee" })).toBeInTheDocument();
    expect(await screen.findByText(projectFixture.name)).toBeInTheDocument();
  });

  it("navigates to a project's editor route when its card is clicked", async () => {
    render(<App />);
    const card = await screen.findByText(projectFixture.name);

    fireEvent.click(card);

    // The home icon performs an async save-then-navigate (Editor.tsx handleGoHome), so it's a
    // button now, not a plain <Link> -- role="link" would no longer match it.
    expect(await screen.findByRole("button", { name: "Back to projects" })).toBeInTheDocument();
    expect(await screen.findAllByText(projectFixture.name)).not.toHaveLength(0);
  });
});
