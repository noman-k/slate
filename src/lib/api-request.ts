/**
 * API steps: building a request from a step (with {{values}} filled in), checking where
 * it may go, and sending it through Slate's server.
 */
import { interpolate, type ApiResponse, type HttpMethod, type Lookup, type Procedure, type Step } from "./runner";

export const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
export const REQUEST_TIMEOUT_MS = 15_000;
export const MAX_RESPONSE_BYTES = 1_000_000;

export interface ApiRequest {
  method: HttpMethod;
  url: string;
  headers: [string, string][];
  body?: string;
}

/** "Name: value" lines → header pairs (blank and malformed lines are skipped). */
export function parseHeaders(text: string): [string, string][] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const colon = line.indexOf(":");
      return colon > 0 ? ([line.slice(0, colon).trim(), line.slice(colon + 1).trim()] as [string, string]) : null;
    })
    .filter((pair): pair is [string, string] => !!pair && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(pair[0]));
}

/** The request a step makes for this run. Values are encoded for where they land. */
export function buildRequest(
  step: Step,
  procedure: Procedure,
  vars: Record<string, string>,
  lookup?: Lookup,
): ApiRequest {
  const method = HTTP_METHODS.includes(step.method as HttpMethod) ? (step.method as HttpMethod) : "GET";
  const url = interpolate((step.url || "").trim(), procedure, vars, lookup, "url");
  const headers = parseHeaders(interpolate(step.headers || "", procedure, vars, lookup));
  const rawBody = (step.body || "").trim();
  const json = /^[[{]/.test(rawBody);
  const body =
    method === "GET" || !rawBody ? undefined : interpolate(rawBody, procedure, vars, lookup, json ? "json" : "none");
  if (body && json && !headers.some(([name]) => name.toLowerCase() === "content-type"))
    headers.push(["Content-Type", "application/json"]);
  return { method, url, headers, ...(body ? { body } : {}) };
}

/** Headers whose values are secrets: shown masked in Run mode and the log. */
export const isSecretHeader = (name: string) =>
  /^(authorization|proxy-authorization|cookie)$|(api[-_]?key|token|secret|password)/i.test(name);
/** "Bearer sk_live_abc123" → "Bearer ••••c123": the scheme stays, the secret doesn't. */
export function maskSecret(value: string) {
  const scheme = /^(Bearer|Basic|Token)\s+/i.exec(value)?.[0] ?? "";
  const secret = value.slice(scheme.length);
  return `${scheme}••••${secret.length > 8 ? secret.slice(-4) : ""}`;
}

/** Hosts a request must never reach from the server: this machine and private networks. */
function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal"))
    return true;
  if (host === "metadata.google.internal" || host === "0.0.0.0" || host === "::" || host === "::1") return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  // IPv6 unique-local (fc00::/7), link-local (fe80::/10) and IPv4-mapped addresses.
  if (/^(f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/.test(host) || host.startsWith("::ffff:")) return true;
  // Decimal or hex IPv4 written as one number ("2130706433", "0x7f000001").
  if (/^(0x[0-9a-f]+|\d+)$/.test(host)) return true;
  return false;
}

/** Why a URL can't be called, or null if it can. */
export function urlProblem(url: string, options: { allowPrivate?: boolean } = {}): string | null {
  if (!url) return "Add the URL to call.";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "That isn't a full URL — it should start with https://";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "Only http and https addresses can be called.";
  if (parsed.username || parsed.password) return "Put credentials in a header, not in the URL.";
  if (!options.allowPrivate && isPrivateHost(parsed.hostname))
    return "Private and local network addresses can't be called from Slate's server.";
  return null;
}

/**
 * Sends a request through Slate's server and reads the answer; never throws. The server
 * allows local addresses only in development, so the browser checks the same way.
 */
export async function sendRequest(request: ApiRequest): Promise<ApiResponse> {
  const problem = urlProblem(request.url, { allowPrivate: process.env.NODE_ENV !== "production" });
  if (problem) return { status: 0, ok: false, body: "", error: problem };
  const started = performance.now();
  try {
    const response = await fetch("/api/run-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS + 5_000),
    });
    const data = (await response.json().catch(() => null)) as (ApiResponse & { error?: string }) | null;
    if (!data) return { status: 0, ok: false, body: "", error: "Slate's server didn't answer. Try again.", ms: Math.round(performance.now() - started) };
    return { ...data, ms: Math.round(performance.now() - started) };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return {
      status: 0,
      ok: false,
      body: "",
      ms: Math.round(performance.now() - started),
      error: timedOut ? `No answer within ${REQUEST_TIMEOUT_MS / 1000} seconds.` : "Couldn't reach Slate's server.",
    };
  }
}

/** A response body, pretty-printed when it's JSON. */
export function prettyBody(body: string) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
