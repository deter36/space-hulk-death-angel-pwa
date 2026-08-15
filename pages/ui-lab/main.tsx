import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import UiLab from "../../src/ui-lab/ui-lab";

const root = document.getElementById("root");

if (!root) throw new Error("Missing UI laboratory root.");

createRoot(root).render(
  <StrictMode>
    <UiLab assetBase="../prototype-art" />
  </StrictMode>,
);
