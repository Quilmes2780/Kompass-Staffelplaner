import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// base "./" → das Bundle in dist/ läuft auch per file:// bzw. von jedem statischen Pfad
export default defineConfig({
  base: "./",
  plugins: [react()],
  // ein einziges Bundle (inkl. Stammdaten und Karte) ist für den Offline-Betrieb gewollt
  build: { chunkSizeWarningLimit: 900 },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 300_000,
  },
});
