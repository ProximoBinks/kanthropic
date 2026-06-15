import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only kanthropic's own tests — the reference kickbacks.ai-main/ copy in
    // this repo has its own (VS Code / jsdom) test deps we don't install.
    include: ["test/**/*.test.mjs"],
  },
});
