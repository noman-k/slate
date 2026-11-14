/**
 * Agent keys: long random secrets an AI agent sends as "Authorization: Bearer slate_…".
 * Only a SHA-256 hash is stored (see the agent_keys migration), so a key is shown once.
 */
export const AGENT_KEY_PREFIX = "slate_";

/** A new key: "slate_" + 32 random bytes, base64url. */
export function generateAgentKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return AGENT_KEY_PREFIX + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The hash that's stored and looked up (hex SHA-256). */
export async function hashAgentKey(key: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** What's shown in the list, so keys can be told apart ("slate_Ab3x"). */
export const agentKeyPrefix = (key: string) => key.slice(0, AGENT_KEY_PREFIX.length + 4);

/** A key in the right shape (checked before anything is looked up). */
export const looksLikeAgentKey = (key: string) => /^slate_[A-Za-z0-9_-]{40,60}$/.test(key);
