import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// The PWA lives in web/; it imports the shared engine straight from src/core.
// .env.local (written by `npx convex dev`) sits at the repo root.
export default defineConfig({
  root: "web",
  base: "./",
  envDir: "..",
  plugins: [preact()],
  build: { outDir: "dist", emptyOutDir: true, target: "es2020" },
  server: { host: true },
});
