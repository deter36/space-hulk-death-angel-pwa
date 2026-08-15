import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing application root.");
}

const uiLabRoute = globalThis.location.pathname.replace(/\/+$/, "").endsWith("/ui-lab");

if (uiLabRoute) {
  const { default: UiLab } = await import("../src/ui-lab/ui-lab");
  createRoot(root).render(<StrictMode><UiLab assetBase="../prototype-art" /></StrictMode>);
} else {
  const [{ default: GameClient }] = await Promise.all([
    import("../app/game-client"),
    import("../app/globals.css"),
  ]);
  createRoot(root).render(<StrictMode><GameClient /></StrictMode>);
}
