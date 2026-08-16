import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/space-hulk-death-angel-pwa/",
  root: "pages",
  publicDir: "../public",
  define: {
    __BUILD_VERSION__: JSON.stringify(process.env.GITHUB_SHA ?? "development"),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  build: {
    outDir: "../dist-pages",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        game: fileURLToPath(new URL("./pages/index.html", import.meta.url)),
        uiLab: fileURLToPath(new URL("./pages/ui-lab/index.html", import.meta.url)),
        gameView: fileURLToPath(new URL("./pages/ui-lab/game-view/index.html", import.meta.url)),
        swarmAnimation: fileURLToPath(new URL("./pages/ui-lab/swarm-animation/index.html", import.meta.url)),
        swarmMovement: fileURLToPath(new URL("./pages/ui-lab/swarm-movement/index.html", import.meta.url)),
        terrainConcepts: fileURLToPath(new URL("./pages/ui-lab/terrain-concepts/index.html", import.meta.url)),
      },
    },
  },
});
