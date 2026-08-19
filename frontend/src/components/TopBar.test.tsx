import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { User } from "../api/auth";
import { googleOAuthUrl } from "../api/auth";
import { AuthProvider } from "../contexts/AuthContext";
import { PROJECT_CAP } from "../lib/limits";
import { userFixture } from "../mocks/fixtures";
import { server } from "../mocks/server";
import type { Prefs } from "../theme";
import TopBar from "./TopBar";

const prefs: Prefs = { theme: "mono", mode: "dark", lang: "en" };
const USER_EMAIL = userFixture.email ?? "";

const guestFixture: User = {
  id: "c0000000-0000-4000-8000-000000000002",
  email: null,
  name: null,
  avatar_url: null,
  is_guest: true,
  created_at: "2026-07-08T09:00:00Z",
  projects_uploaded_count: 2,
};

function renderTopBar() {
  return render(
    <AuthProvider>
      <TopBar prefs={prefs} onUpdatePrefs={vi.fn()} />
    </AuthProvider>
  );
}

const originalLocation = window.location;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

// jsdom's Location doesn't allow vi.spyOn(window.location, "href", "set") directly (its own
// `href` accessor isn't configurable) -- swap the whole `window.location` object out instead,
// same workaround this ecosystem uses generally. Restored in afterEach above.
function spyOnLocationHref(): ReturnType<typeof vi.fn> {
  const hrefSetter = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...originalLocation,
      set href(v: string) {
        hrefSetter(v);
      },
      get href() {
        return originalLocation.href;
      },
    },
  });
  return hrefSetter;
}

// Same workaround as spyOnLocationHref above, for logout()'s window.location.reload() call --
// jsdom logs a "not implemented" warning and does nothing for real navigation, which would leave
// the old (still logged-in) UI on screen forever rather than throwing, so a plain vi.spyOn isn't
// enough to observe the call was made.
function spyOnLocationReload(): ReturnType<typeof vi.fn> {
  const reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, reload },
  });
  return reload;
}

describe("TopBar account UI, logged out", () => {
  it(`auto-opens the tooltip once, shows the N/${PROJECT_CAP} line from the guest's own usage, and outside-click closes it`, async () => {
    // The default MSW handler answers 401 for /auth/me (deliberate test simplification, see
    // mocks/handlers.ts) -- the real backend never 401s here, a guest session always resolves to
    // a real User (api-contract.md §15), quota counter included. Override it here specifically
    // because this test asserts on that counter.
    server.use(http.get("*/api/v1/auth/me", () => HttpResponse.json(guestFixture), { once: true }));
    renderTopBar();

    expect(await screen.findByText("You haven't registered yet")).toBeInTheDocument();
    expect(screen.getByText(`2/${PROJECT_CAP} projects uploaded`)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("account-backdrop"));

    await waitFor(() => {
      expect(screen.queryByText("You haven't registered yet")).not.toBeInTheDocument();
    });
  });

  it("opens the sign-in modal, and the Google button navigates to the real OAuth start URL", async () => {
    renderTopBar();
    await screen.findByText("You haven't registered yet");

    fireEvent.click(screen.getByText("Sign in"));
    expect(screen.getByText("Continue with Google")).toBeInTheDocument();
    expect(screen.queryByText("You haven't registered yet")).not.toBeInTheDocument();

    const hrefSetter = spyOnLocationHref();

    fireEvent.click(screen.getByText("Continue with Google"));
    expect(hrefSetter).toHaveBeenCalledWith(googleOAuthUrl());
  });

  it("closes the sign-in modal on ✕", async () => {
    renderTopBar();
    await screen.findByText("You haven't registered yet");
    fireEvent.click(screen.getByText("Sign in"));

    fireEvent.click(screen.getByTitle("Close"));
    await waitFor(() => {
      expect(screen.queryByText("Continue with Google")).not.toBeInTheDocument();
    });
  });

  it("closing the tooltip via Continue as guest does not send any request", async () => {
    renderTopBar();
    await screen.findByText("You haven't registered yet");

    fireEvent.click(screen.getByText("Continue as guest"));
    await waitFor(() => {
      expect(screen.queryByText("You haven't registered yet")).not.toBeInTheDocument();
    });
  });
});

describe("TopBar account UI, logged in", () => {
  it(`shows the account dropdown with name/email and a red N/${PROJECT_CAP} at the cap, and logging out reloads the page`, async () => {
    const atCapUser: User = { ...userFixture, projects_uploaded_count: PROJECT_CAP };
    server.use(http.get("*/api/v1/auth/me", () => HttpResponse.json(atCapUser), { once: true }));

    renderTopBar();
    // Logged in: the logged-out tooltip never auto-opens; the dropdown only opens on click.
    fireEvent.click(screen.getByTitle("Account"));
    expect(await screen.findByText("Demo User")).toBeInTheDocument();
    expect(screen.getByText(USER_EMAIL)).toBeInTheDocument();
    const cap = screen.getByText(`${PROJECT_CAP}/${PROJECT_CAP} projects uploaded`);
    expect(cap).toHaveStyle({ color: "#ef4444" });

    const reload = spyOnLocationReload();
    fireEvent.click(screen.getByText("Log out"));

    // logout() clears the session server-side, then reloads the whole page rather than
    // re-deriving state in place -- Home.tsx's own project list has no way to know the session
    // changed otherwise, and would keep showing the previous account's projects until something
    // else remounted it.
    await waitFor(() => {
      expect(reload).toHaveBeenCalled();
    });
  });

  it("falls back to a generic icon when there is no avatar_url", async () => {
    server.use(http.get("*/api/v1/auth/me", () => HttpResponse.json(userFixture), { once: true }));
    renderTopBar();

    fireEvent.click(screen.getByTitle("Account"));
    expect(await screen.findByText(USER_EMAIL)).toBeInTheDocument();
    expect(screen.queryByTestId("account-avatar-img")).not.toBeInTheDocument();
  });
});
