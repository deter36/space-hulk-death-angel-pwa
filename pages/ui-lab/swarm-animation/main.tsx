import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SwarmAnimationDemo from "../../../src/ui-lab/swarm-animation-demo";

const root = document.getElementById("root");
if (!root) throw new Error("Missing swarm animation preview root.");
createRoot(root).render(<StrictMode><SwarmAnimationDemo assetBase="../../prototype-art" /></StrictMode>);
