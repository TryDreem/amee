import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { getCurrentUser, logout as apiLogout, startGoogleOAuth as apiStartGoogleOAuth, updateAvatar as apiUpdateAvatar, type User } from "../api/auth";

// Same provider shape as ExportContext/TranscribeContext, but deliberately does NOT cache `User`
// in storage the way those cache job records -- identity must always be re-derived fresh from
// getCurrentUser() on mount, never trusted from local state. The only thing persisted is the
// tooltip's one-time-auto-open dismissal flag.
const TOOLTIP_SESSION_KEY = "amee_account_tooltip_dismissed";

function readTooltipDismissed(): boolean {
  try {
    return sessionStorage.getItem(TOOLTIP_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function writeTooltipDismissed(): void {
  try {
    sessionStorage.setItem(TOOLTIP_SESSION_KEY, "1");
  } catch {
    // Storage full/unavailable (private mode) -- the tooltip may just reopen next session.
  }
}

interface AuthContextValue {
  status: "loading" | "ready";
  user: User | null;
  // A guest still gets a real `User` (silent, backend-issued) -- isLoggedIn is derived so the UI
  // keeps showing logged-out chrome for a guest, branching on is_guest rather than user != null.
  isLoggedIn: boolean;
  tooltipDismissed: boolean;
  dismissTooltip: () => void;
  startGoogleOAuth: () => void;
  logout: () => Promise<void>;
  // Re-fetches /auth/me in place, without a full reload -- unlike logout(), nothing about
  // "who's signed in" changes here, so there's no other state that needs resetting. The one
  // known caller is projects_uploaded_count: it only changes server-side once a transcription
  // finishes, and nothing pushes that change to an already-mounted tab on its own.
  refresh: () => Promise<void>;
  photoBusy: boolean;
  photoError: string | null;
  updateAvatar: (file: File) => Promise<{ ok: true } | { ok: false; error: string }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [user, setUser] = useState<User | null>(null);
  const [tooltipDismissed, setTooltipDismissed] = useState(() => readTooltipDismissed());
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // getCurrentUser() never throws (see api/auth.ts) -- a network hiccup just leaves `user` as
    // it was rather than clearing a real session out from under the account UI.
    const next = await getCurrentUser();
    if (next) {
      setUser(next);
    }
  }, []);

  useEffect(() => {
    void getCurrentUser().then((u) => {
      setUser(u);
      setStatus("ready");
    });
  }, []);

  const dismissTooltip = useCallback(() => {
    writeTooltipDismissed();
    setTooltipDismissed(true);
  }, []);

  const startGoogleOAuth = useCallback(() => {
    apiStartGoogleOAuth();
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    // A full reload, not just re-deriving `user` here: AuthContext isn't the only state keyed on
    // "who is logged in" -- Home.tsx's own project list (GET /projects, now owner-scoped) has no
    // way to know the session changed and would otherwise keep showing the previous account's
    // projects until something else remounted it. Reloading resets everything at once, and the
    // next /auth/me call mints a fresh guest same as any other cookie-less request.
    window.location.reload();
  }, []);

  const updateAvatar = useCallback(
    async (file: File): Promise<{ ok: true } | { ok: false; error: string }> => {
      setPhotoBusy(true);
      setPhotoError(null);
      try {
        const next = await apiUpdateAvatar(file);
        setUser(next);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Couldn't update your photo.";
        setPhotoError(message);
        return { ok: false, error: message };
      } finally {
        setPhotoBusy(false);
      }
    },
    []
  );

  const value: AuthContextValue = {
    status,
    user,
    isLoggedIn: !!user && !user.is_guest,
    tooltipDismissed,
    dismissTooltip,
    startGoogleOAuth,
    logout,
    refresh,
    photoBusy,
    photoError,
    updateAvatar,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
