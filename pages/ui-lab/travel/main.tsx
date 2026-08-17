import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import TravelDemo from "../../../src/ui-lab/travel-demo";

const root = document.getElementById("root");
if (!root) throw new Error("Missing travel animation preview root.");
createRoot(root).render(<StrictMode><TravelDemo assetBase="../../prototype-art" /></StrictMode>);
