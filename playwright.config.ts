import { defineConfig, devices } from "@playwright/test";
import { localSupabase } from "./tests/browser/support";

// Slate needs Supabase to sign in, so the tests start their own dev server wired to the
// local stack (`supabase start`) on a port of its own. PLAYWRIGHT_BASE_URL points them at
// a server you run yourself instead.
const external = process.env.PLAYWRIGHT_BASE_URL;
const port = 3100;
const baseURL = external || `http://localhost:${port}`;
const supabase = external ? null : localSupabase();

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: supabase
    ? {
        command: `npm run dev -- --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          NEXT_PUBLIC_SUPABASE_URL: supabase.url,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.key,
          NEXT_PUBLIC_APP_URL: baseURL,
          // Low limits so the rate-limit tests reach them quickly; each test uses its own
          // account and key, so other tests stay well under them.
          SLATE_DEV_RATE_LIMITS: "RUN_REQUEST_LIMITER=5,MCP_KEY_LIMITER=5",
        },
      }
    : undefined,
});
