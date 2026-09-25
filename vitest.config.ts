import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    // Pinned to the city's timezone (America/Sao_Paulo, the same one every
    // Intl.DateTimeFormat in the app formats with — see src/lib/format.ts):
    // `vi.setSystemTime` fixes the instant, not the process TZ, so any test
    // that parses a `datetime-local` value with `new Date(value)` (local
    // zone) and later compares against a fixed-TZ-formatted string is only
    // deterministic if the process TZ matches. CI (ubuntu-latest) defaults
    // to UTC, which broke Requests.test.tsx's 48h-warning assertions.
    env: { TZ: "America/Sao_Paulo" }
  }
});
