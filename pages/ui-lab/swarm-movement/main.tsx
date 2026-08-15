import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SwarmMovementDemo from "../../../src/ui-lab/swarm-movement-demo";

const root = document.getElementById("root");
if (!root) throw new Error("Missing swarm movement preview root.");
createRoot(root).render(<StrictMode><SwarmMovementDemo assetBase="../../prototype-art" /></StrictMode>);
