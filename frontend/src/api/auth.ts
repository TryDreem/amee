import { apiBase, apiFetch } from "./client";

// Hand-authored, NOT generated — no backend User schema/route exists yet (plan: Part B). Field
// names/shape match what Part B's schemas/user.py already defines, so once `make types` produces
// a real generated type this interface is a delete, not a rewrite of every call site.
export interface User {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  is_guest: boolean;
  created_at: string;
}

// Never throws — a 404 (today's real backend, no /auth/* routes at all), a future 401, or a
// network error are all "not logged in". AuthContext relies on this to render safely against
// both today's authless backend and tomorrow's real one with no branching of its own.
export async function getCurrentUser(): Promise<User | null> {
  try {
    return await apiFetch<User>("/auth/me", { credentials: "include" });
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  await apiFetch<undefined>("/auth/logout", { method: "POST", credentials: "include" });
}

export async function updateAvatar(file: File): Promise<User> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<User>("/auth/me/avatar", {
    method: "POST",
    credentials: "include",
    body: formData,
  });
}

// Real OAuth is a full-page redirect, not a fetch -- split into a pure URL builder (testable
// without touching window.location) and the actual navigation call.
export function googleOAuthUrl(): string {
  return `${apiBase()}/auth/google/start`;
}

export function startGoogleOAuth(): void {
  window.location.href = googleOAuthUrl();
}
