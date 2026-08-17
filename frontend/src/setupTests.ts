import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./mocks/server";

// jsdom has no ResizeObserver — Editor.tsx uses one to size the caption overlay.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
  // ExportContext/TranscribeContext persist their tracked jobs here, and jsdom keeps one storage
  // per test file — without this, a job tracked by one test reappears in the next one's provider.
  // Guarded: the api-client suite runs in the node environment, which has no sessionStorage.
  globalThis.sessionStorage?.clear();
});
afterAll(() => server.close());
