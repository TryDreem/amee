import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "./App";
import { projectFixture } from "./mocks/fixtures";

describe("App", () => {
  it("renders the logo and the real project list from the API", async () => {
    render(<App />);
    expect(screen.getByRole("img", { name: "Amee" })).toBeInTheDocument();
    expect(await screen.findByText(projectFixture.name)).toBeInTheDocument();
  });
});
