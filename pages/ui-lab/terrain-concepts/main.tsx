import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import TerrainConcepts from "../../../src/ui-lab/terrain-concepts";

const root = document.getElementById("root");
if (!root) throw new Error("Missing terrain concepts root.");

createRoot(root).render(<StrictMode><TerrainConcepts /></StrictMode>);
