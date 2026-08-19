import { apiBase, apiFetch } from "./client";

// Hand-authored, NOT generated — matches backend/app/schemas/user.py field-for-field. Once
// `make types` runs against it, this interface becomes a delete, not a rewrite of every call site.
export interface User {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  is_guest: boolean;
  created_at: string;
  // Quota model's counter (api-contract.md §15) — survives project deletion, only increments on
  // a transcribe job that actually reaches "done". The account UI's "N/3" line reads this, not a
  // live count of the caller's current projects.
  projects_uploaded_count: number;
}

// Never throws — a 404, a 401, or a network error are all "not logged in". AuthContext relies on
// this to render safely with no branching of its own.
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
