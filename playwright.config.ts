import { defineConfig } from "@playwright/test";

const PORT = 3200;
const chrome = process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1366, height: 800 },
    launchOptions: { executablePath: chrome },
  },
  // A freshly seeded database every run. Build first: `bun run e2e` does.
  webServer: {
    command: `sh -c 'rm -f data/e2e.db data/e2e.db-wal data/e2e.db-shm; REFUNDO_DB=data/e2e.db bun --bun next start -p ${PORT}'`,
    url: `http://localhost:${PORT}/login`,
    timeout: 60_000,
    reuseExistingServer: false,
  },
});
