import { createRequire } from "node:module";
import { writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { experimental_readRawConfig } from "wrangler";
const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd(), false);
const flags = process.argv.slice(2);
if (flags.some((flag) => flag !== "--check"))
  throw new Error("Supported option: --check (validate configuration without deploying).");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key)
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY before deploying.");
const parsed = new URL(url);
if (
  parsed.protocol !== "https:" &&
  !(parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
)
  throw new Error("Supabase must use HTTPS outside local development.");
if (parsed.username || parsed.password) throw new Error("The Supabase public URL must not contain credentials.");
if (key.startsWith("sb_secret_")) throw new Error("A server secret cannot be used as a public Supabase key.");
if (key.split(".").length === 3) {
  const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
  if (claims.role !== "anon")
    throw new Error("Only a public publishable or legacy anon key can be included in browser assets.");
} else if (!key.startsWith("sb_publishable_")) throw new Error("Expected a public Supabase publishable key.");
const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" }, { useRedirectIfAvailable: false });
const config = {
  ...rawConfig,
  vars: {
    ...rawConfig.vars,
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
    ...(process.env.NEXT_PUBLIC_APP_URL ? { NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL } : {}),
  },
};
const filename = `wrangler.deploy.generated-${process.pid}.jsonc`;
try {
  await writeFile(filename, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  if (flags.includes("--check"))
    console.log("Validated Supabase runtime bindings and generated Wrangler configuration. No deployment performed.");
  else {
    const cli = path.resolve("node_modules/@opennextjs/cloudflare/dist/cli/index.js");
    const result = spawnSync(process.execPath, [cli, "deploy", "--config", filename], {
      stdio: "inherit",
      env: process.env,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
} finally {
  await rm(filename, { force: true });
}
