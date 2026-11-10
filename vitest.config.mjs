import { defineConfig } from "vitest/config";

// Set before workers start: date helpers use local civil dates.
process.env.TZ = "Europe/Moscow";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.mjs"],
    passWithNoTests: false,
    retry: 0,
    testTimeout: 5000,
    coverage: {
      provider: "v8",
      include: [
        "app/js/core/dates.js",
        "app/js/core/calendar.js",
        "app/js/core/plan.js",
        "app/js/core/schedule.js",
      ],
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
      reportOnFailure: true,
    },
  },
});
