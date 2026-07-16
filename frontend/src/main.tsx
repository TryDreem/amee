import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";

async function prepare(): Promise<void> {
  if (import.meta.env.VITE_API_MOCK === "1") {
    const { worker } = await import("./mocks/browser");
    await worker.start({ onUnhandledRequest: "warn" });
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("#root element not found");
}

void prepare().then(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
});
