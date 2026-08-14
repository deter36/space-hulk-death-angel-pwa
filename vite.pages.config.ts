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
  },
});
