import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// base "./" → das Bundle in dist/ läuft auch per file:// bzw. von jedem statischen Pfad
export default defineConfig({
  base: "./",
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 300_000,
  },
});
