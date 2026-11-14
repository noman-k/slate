"use client";
/**
 * Settings › AI agents: keys that let an AI agent (Claude, or anything that speaks MCP)
 * read this workspace. A key is made here, shown once, stored only as a hash, and can be
 * revoked at any time.
 */
import { useCallback, useEffect, useState } from "react";
import { Bot, Check, Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { agentKeyPrefix, generateAgentKey, hashAgentKey } from "@/lib/agent-keys";

type AgentKey = { id: string; name: string; key_prefix: string; created_at: string; last_used_at: string | null };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "never";

function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="agent-copy">
      <span>{label}</span>
      <div>
        <code className={mono ? "" : "is-plain"}>{value}</code>
        <button
          type="button"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() =>
            navigator.clipboard
              ?.writeText(value)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => toast("Couldn't copy"))
          }
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}

export function AgentKeysSection({ isDemo }: { isDemo: boolean }) {
  const [keys, setKeys] = useState<AgentKey[] | null>(null);
  const [name, setName] = useState("Claude");
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const endpoint = typeof window === "undefined" ? "/api/mcp" : `${window.location.origin}/api/mcp`;

  const client = async () => (await import("@/lib/supabase/client")).getSupabaseClient();
  const refresh = useCallback(async () => {
    const { data, error } = await (await client())
      .from("agent_keys")
      .select("id,name,key_prefix,created_at,last_used_at")
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (error) {
      setKeys([]);
      toast.error("Couldn't load agent keys. Has the latest database migration been applied?");
    } else setKeys(data as AgentKey[]);
  }, []);
  useEffect(() => {
    if (isDemo) return;
    queueMicrotask(() => void refresh());
  }, [isDemo, refresh]);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const key = generateAgentKey();
    const { error } = await (await client())
      .from("agent_keys")
      .insert({ name: name.trim(), key_hash: await hashAgentKey(key), key_prefix: agentKeyPrefix(key) });
    setBusy(false);
    if (error) {
      toast.error("Couldn't create the key. Try again.");
      return;
    }
    setCreated({ name: name.trim(), key });
    setName("Claude");
    void refresh();
  };
  const revoke = async (id: string) => {
    const { error } = await (await client()).from("agent_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    setConfirming(null);
    if (error) toast.error("Couldn't revoke the key. Try again.");
    else {
      toast("Key revoked — agents using it can no longer read this workspace");
      void refresh();
    }
  };

  return (
    <section className="settings-section" aria-label="AI agents">
      <h3>AI agents</h3>
      <div className="settings-note">
        <Bot size={16} />
        <div>
          <strong>Let an AI agent read this workspace</strong>
          <p>
            Agents like Claude can search your pages, read them, query your databases and look up playbooks. They
            can&apos;t change anything. Each agent uses its own key, which you can revoke at any time.
          </p>
        </div>
      </div>
      {isDemo ? (
        <p className="settings-muted">Connect Supabase to use agent keys — the local demo lives only in this browser.</p>
      ) : (
        <>
          {created && (
            <div className="agent-created" role="status">
              <strong>
                <KeyRound size={15} /> “{created.name}” key — copy it now, it won&apos;t be shown again
              </strong>
              <CopyField label="Key" value={created.key} />
              <CopyField label="Endpoint (MCP)" value={endpoint} />
              <CopyField
                label="Add to Claude Code"
                value={`claude mcp add --transport http slate ${endpoint} --header "Authorization: Bearer ${created.key}"`}
              />
              <button type="button" className="agent-dismiss" onClick={() => setCreated(null)}>
                I&apos;ve copied it
              </button>
            </div>
          )}
          <form
            className="settings-name"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label className="field-label">
              New key for
              <span className="settings-inline">
                <input
                  value={name}
                  maxLength={80}
                  placeholder="e.g. Claude on my laptop"
                  onChange={(event) => setName(event.target.value)}
                />
                <Button disabled={!name.trim() || busy}>Create key</Button>
              </span>
            </label>
          </form>
          {keys && keys.length > 0 && (
            <ul className="agent-keys" aria-label="Agent keys">
              {keys.map((key) => (
                <li key={key.id}>
                  <div>
                    <strong>{key.name}</strong>
                    <small>
                      <code>{key.key_prefix}…</code> · created {when(key.created_at)} · last used {when(key.last_used_at)}
                    </small>
                  </div>
                  {confirming === key.id ? (
                    <span className="agent-confirm">
                      <button type="button" className="danger-text" onClick={() => void revoke(key.id)}>
                        Revoke
                      </button>
                      <button type="button" onClick={() => setConfirming(null)}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="secondary-button" onClick={() => setConfirming(key.id)}>
                      Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {keys && keys.length === 0 && !created && <p className="settings-muted">No agent keys yet.</p>}
        </>
      )}
    </section>
  );
}
