"use client";
/**
 * Settings › AI agents: keys that let an AI agent (Claude, or anything that speaks MCP)
 * use this workspace. Each key belongs to one workspace and can't reach any other, so
 * the list here is this workspace's keys. A key is made here, shown once, stored only as
 * a hash, and can be revoked at any time.
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Bot, Check, Copy, KeyRound, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { agentKeyPrefix, generateAgentKey, hashAgentKey } from "@/lib/agent-keys";
import { AGENT_SCOPES, scopeLabel, type AgentScope } from "@/lib/agent-scopes";

type Scope = AgentScope;
type AgentKey = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  scope?: Scope;
  workspace_id: string;
  /** Set for an app connected by signing in (OAuth), not with a pasted key. */
  client_id?: string | null;
};
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

export function AgentKeysSection({
  workspace,
  workspaceCount,
}: {
  workspace: { id: string; name: string };
  /** How many workspaces the person has: with more than one, say which this is. */
  workspaceCount: number;
}) {
  const [allKeys, setKeys] = useState<AgentKey[] | null>(null);
  const keys = allKeys?.filter((key) => key.workspace_id === workspace.id) ?? null;
  const elsewhere = (allKeys?.length ?? 0) - (keys?.length ?? 0);
  const workspaceName = workspace.name || "Untitled workspace";
  const [name, setName] = useState("Claude");
  const [scope, setScope] = useState<Scope>("read");
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const endpoint = typeof window === "undefined" ? "/api/mcp" : `${window.location.origin}/api/mcp`;

  const client = async () => (await import("@/lib/supabase/client")).getSupabaseClient();
  const refresh = useCallback(async () => {
    const { data, error } = await (
      await client()
    )
      .from("agent_keys")
      .select("id,name,key_prefix,created_at,last_used_at,scope,workspace_id,client_id")
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (error) {
      setKeys([]);
      toast.error("Couldn't load agent keys. Has the latest database migration been applied?");
    } else setKeys(data as AgentKey[]);
  }, []);
  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const key = generateAgentKey();
    const { error } = await (await client()).from("agent_keys").insert({
      name: name.trim(),
      key_hash: await hashAgentKey(key),
      key_prefix: agentKeyPrefix(key),
      scope,
      workspace_id: workspace.id,
    });
    setBusy(false);
    if (error) {
      // A workspace made a moment ago may not have reached the server yet.
      toast.error(
        error.code === "23503" || error.code === "42501"
          ? "This workspace hasn't finished saving. Try again in a moment."
          : "Couldn't create the key. Try again.",
      );
      return;
    }
    setCreated({ name: name.trim(), key });
    setName("Claude");
    setScope("read");
    void refresh();
  };
  const revoke = async (id: string) => {
    const { error } = await (
      await client()
    )
      .from("agent_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    setConfirming(null);
    const app = allKeys?.find((key) => key.id === id)?.client_id;
    if (error) toast.error(app ? "Couldn't disconnect the app. Try again." : "Couldn't revoke the key. Try again.");
    else {
      toast(
        app
          ? `Disconnected — it can no longer use ${workspaceName}`
          : `Key revoked — agents using it can no longer use ${workspaceName}`,
      );
      void refresh();
    }
  };

  return (
    <section className="settings-section" aria-label="AI agents">
      <h3>AI agents</h3>
      <div className="settings-note">
        <Bot size={16} />
        <div>
          <strong>Let an AI agent use {workspaceCount > 1 ? `“${workspaceName}”` : "this workspace"}</strong>
          <p>
            Agents like Claude can search your pages, read them, query your databases and look up playbooks. If you
            allow it, they can also create new ones, or edit what&apos;s there; nothing is ever deleted for good.
            Connect an app by adding <code className="agent-url">{endpoint}</code> to it and signing in, or create a key
            for apps that need one. Revoke either at any time.
          </p>
          <p className="agent-boundary">
            <Lock size={13} aria-hidden />
            {workspaceCount > 1
              ? "A key opens only the workspace it was made in. Your other workspaces stay out of its reach."
              : "A key opens only this workspace. Any workspace you add later stays out of its reach."}
          </p>
          <a className="agent-guide" href="/docs/mcp" target="_blank" rel="noreferrer">
            Setup guide for Claude, ChatGPT, Codex, Cursor and more
            <ArrowUpRight size={13} />
          </a>
        </div>
      </div>
      <>
        {created && (
          <div className="agent-created" role="status">
            <strong>
              <KeyRound size={15} /> “{created.name}” key for {workspaceName} — copy it now, it won&apos;t be shown
              again
            </strong>
            <CopyField label="Key" value={created.key} />
            <CopyField label="Endpoint (MCP)" value={endpoint} />
            <CopyField
              label="Add to Claude Code"
              value={`claude mcp add --transport http slate ${endpoint} --header "Authorization: Bearer ${created.key}"`}
            />
            <a className="agent-guide" href="/docs/mcp#setup" target="_blank" rel="noreferrer">
              Using another app? See the setup guide
              <ArrowUpRight size={13} />
            </a>
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
          <fieldset className="agent-scope">
            <legend>What it can do</legend>
            {AGENT_SCOPES.map((option) => (
              <label key={option.value} className={scope === option.value ? "is-on" : undefined}>
                <input
                  type="radio"
                  name="agent-scope"
                  value={option.value}
                  checked={scope === option.value}
                  onChange={() => setScope(option.value)}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.hint}</small>
                </span>
              </label>
            ))}
          </fieldset>
        </form>
        {keys && keys.length > 0 && (
          <ul className="agent-keys" aria-label="Connected apps and agent keys">
            {keys.map((key) => (
              <li key={key.id}>
                <div>
                  <strong>
                    {key.name}
                    <span
                      className={`agent-scope-badge ${key.scope === "write" || key.scope === "edit" ? "is-write" : ""} ${key.scope === "edit" ? "is-edit" : ""}`}
                    >
                      {scopeLabel(key.scope)}
                    </span>
                  </strong>
                  <small>
                    {key.client_id ? "Connected by signing in" : <code>{key.key_prefix}…</code>} ·{" "}
                    {key.client_id ? "connected" : "created"} {when(key.created_at)} · last used{" "}
                    {when(key.last_used_at)}
                  </small>
                </div>
                {confirming === key.id ? (
                  <span className="agent-confirm">
                    <button type="button" className="danger-text" onClick={() => void revoke(key.id)}>
                      {key.client_id ? "Disconnect" : "Revoke"}
                    </button>
                    <button type="button" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button type="button" className="secondary-button" onClick={() => setConfirming(key.id)}>
                    {key.client_id ? "Disconnect" : "Revoke"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {keys && keys.length === 0 && !created && (
          <p className="settings-muted">No apps or agent keys for this workspace yet.</p>
        )}
        {elsewhere > 0 && (
          <p className="settings-muted">
            {elsewhere === 1 ? "1 app or key belongs" : `${elsewhere} apps and keys belong`} to your other workspaces.
            Switch to a workspace to see and revoke them.
          </p>
        )}
      </>
    </section>
  );
}
