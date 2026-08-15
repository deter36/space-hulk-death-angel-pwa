import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import GameView from "../../../src/ui-lab/game-view";

const root = document.getElementById("root");
if (!root) throw new Error("Missing mobile game-view root.");

createRoot(root).render(<StrictMode><GameView assetBase="../../prototype-art" /></StrictMode>);
