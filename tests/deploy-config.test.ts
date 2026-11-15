import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
const run = (key: string, url = "http://127.0.0.1:56321") =>
  spawnSync(process.execPath, ["scripts/deploy-worker.mjs", "--check"], {
    encoding: "utf8",
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key },
  });
describe("production runtime configuration", () => {
  it("validates public bindings without deploying and removes its temporary config", () => {
    const before = readdirSync(".").filter((file) => file.startsWith("wrangler.deploy.generated-"));
    const result = run("sb_publishable_local_validation_fixture");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No deployment performed");
    expect(readdirSync(".").filter((file) => file.startsWith("wrangler.deploy.generated-"))).toEqual(before);
  });
  it("refuses a server secret as a browser public key", () => {
    const result = run("sb_secret_validation_fixture");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("server secret cannot be used");
  });
  it("refuses an insecure remote Supabase origin", () => {
    const result = run("sb_publishable_local_validation_fixture", "http://remote.example.test");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("HTTPS outside local development");
  });
});
