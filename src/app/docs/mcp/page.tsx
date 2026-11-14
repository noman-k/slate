import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { ArrowRight, BookOpen, Eye, KeyRound, Lock, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AGENT_TOOLS, type ToolDefinition } from "@/lib/agent-tools";
import { SUPPORTED_PROTOCOLS } from "@/lib/mcp";
import { ClientSetup, CodeBlock, CopyButton, Inline, TableOfContents, type ClientGuide } from "./client-setup";
import "../../landing.css";
import "../docs.css";

export const metadata: Metadata = {
  title: "Connect AI agents (MCP) · Slate",
  description:
    "Let Claude, Cursor, VS Code or any MCP client read your Slate workspace: pages, databases and playbooks. Read-only, with a key you can revoke.",
};

const KEY = "slate_YOUR_KEY";

/** The address this page is served from, so the examples name the right endpoint. */
async function endpoint() {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "slate.noman.io";
  const proto = h.get("x-forwarded-proto") || (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https");
  return `${proto}://${host}/api/mcp`;
}

function guides(url: string): ClientGuide[] {
  return [
    {
      id: "claude-code",
      name: "Claude Code",
      steps: [
        {
          text: `Run this in a terminal, with your key in place of \`${KEY}\`:`,
          caption: "Terminal",
          code: `claude mcp add --transport http slate ${url} \\\n  --header "Authorization: Bearer ${KEY}"`,
        },
        { text: "Start Claude Code and run `/mcp`: slate should be listed as connected." },
      ],
      note: "Add `--scope user` to use Slate in every project, not just this one.",
    },
    {
      id: "claude-desktop",
      name: "Claude Desktop",
      steps: [
        {
          text: "In Claude, open Settings › Developer › Edit Config to open `claude_desktop_config.json`, and add Slate:",
          caption: "claude_desktop_config.json",
          code: JSON.stringify(
            {
              mcpServers: {
                slate: {
                  command: "npx",
                  args: ["mcp-remote", url, "--header", "Authorization:${AUTH_HEADER}"],
                  env: { AUTH_HEADER: `Bearer ${KEY}` },
                },
              },
            },
            null,
            2,
          ),
        },
        { text: "Quit Claude completely and open it again. Slate's tools appear in the tools menu of a new chat." },
      ],
      note: "Slate signs agents in with a key rather than an account login, so Claude Desktop reaches it through the small `mcp-remote` helper, which needs Node.js. The key goes in `env` (not straight into `args`) because some apps mishandle spaces in arguments.",
    },
    {
      id: "cursor",
      name: "Cursor",
      steps: [
        {
          text: "Open `~/.cursor/mcp.json` (every project) or `.cursor/mcp.json` (this project only) and add Slate:",
          caption: "mcp.json",
          code: JSON.stringify({ mcpServers: { slate: { url, headers: { Authorization: `Bearer ${KEY}` } } } }, null, 2),
        },
        { text: "Open Cursor's MCP settings and check that slate is on and shows its tools." },
      ],
      note: "To keep the key out of the file, write `\"Bearer ${env:SLATE_API_KEY}\"` and set `SLATE_API_KEY` in your environment.",
    },
    {
      id: "vscode",
      name: "VS Code",
      steps: [
        {
          text: "Create `.mcp.json` at the root of your workspace:",
          caption: ".mcp.json",
          code: JSON.stringify(
            { mcpServers: { slate: { type: "http", url, headers: { Authorization: "Bearer ${SLATE_API_KEY}" } } } },
            null,
            2,
          ),
        },
        { text: "Set `SLATE_API_KEY` to your key in the environment VS Code starts from, then reload the window." },
        { text: "Run MCP: List Servers from the Command Palette and check that slate is running." },
      ],
      note: "Using an environment variable keeps the key out of a file that might be committed with your project.",
    },
    {
      id: "codex",
      name: "Codex",
      steps: [
        {
          text: "Add Slate to `~/.codex/config.toml`:",
          caption: "~/.codex/config.toml",
          code: `[mcp_servers.slate]\nurl = "${url}"\nbearer_token_env_var = "SLATE_API_KEY"`,
        },
        {
          text: "Set the key in your shell profile (for example `~/.zshrc`), then open a new terminal:",
          caption: "Shell profile",
          code: `export SLATE_API_KEY="${KEY}"`,
        },
      ],
      note: "The same file is used by the Codex CLI, the IDE extension and the desktop app.",
    },
    {
      id: "other",
      name: "Other clients",
      steps: [
        {
          text: "Point any client that supports remote MCP servers over Streamable HTTP at the endpoint, and send your key in the `Authorization` header:",
          caption: "Connection",
          code: `URL:     ${url}\nHeader:  Authorization: Bearer ${KEY}`,
        },
        {
          text: "For a client that only runs local (stdio) servers, start Slate through `mcp-remote`:",
          caption: "Command",
          code: `AUTH_HEADER="Bearer ${KEY}" npx mcp-remote ${url} --header "Authorization:\${AUTH_HEADER}"`,
        },
        {
          text: "To check a key without any client, list the tools with curl:",
          caption: "Terminal",
          code: `curl ${url} \\\n  -H "Authorization: Bearer ${KEY}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
        },
      ],
    },
  ];
}

const EXAMPLES = [
  { prompt: "Which units are late on rent this month?", how: "Queries your Rent Ledger database by status." },
  { prompt: "Find my notes about the Q3 launch and summarize them.", how: "Searches the workspace, then reads the pages it finds." },
  { prompt: "What does our refund playbook say to do for an order over 30 days old?", how: "Looks up the playbook and walks through its steps." },
  { prompt: "What databases do I have, and what does each one track?", how: "Lists your databases with their properties." },
];

type Schema = {
  type?: string | string[];
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
};

/** A parameter's type in plain words: "text", "one of: a, b", "number 1–50", "list of filters". */
function typeOf(schema: Schema): string {
  if (schema.enum) return `one of ${schema.enum.map((v) => `"${v}"`).join(", ")}`;
  const type = Array.isArray(schema.type) ? schema.type.join(" or ") : schema.type;
  if (type === "integer" || type === "number") {
    const range = schema.minimum !== undefined && schema.maximum !== undefined ? ` ${schema.minimum}–${schema.maximum}` : "";
    return `number${range}`;
  }
  if (type === "array") return `list of ${schema.items?.type === "object" ? "objects" : typeOf(schema.items || {})}`;
  if (type === "string") return "text";
  return type || "any";
}

function Params({ schema, prefix = "" }: { schema: Schema; prefix?: string }) {
  const entries = Object.entries(schema.properties || {});
  if (!entries.length && !prefix) return <p className="docs-muted">No parameters.</p>;
  return (
    <>
      {entries.map(([name, prop]) => {
        const nested = prop.type === "array" && prop.items?.properties ? prop.items : prop.type === "object" && prop.properties ? prop : null;
        return (
          <div key={prefix + name} className="docs-param-group">
            <div className="docs-param">
              <code>{prefix + name}</code>
              <span className="docs-param-type">{typeOf(prop)}</span>
              {schema.required?.includes(name) && <span className="docs-required">required</span>}
              {prop.description && <span className="docs-param-desc">{prop.description}</span>}
            </div>
            {nested && <Params schema={nested} prefix={`${prefix}${name}${prop.type === "array" ? "[]" : ""}.`} />}
          </div>
        );
      })}
    </>
  );
}

function Tool({ tool }: { tool: ToolDefinition }) {
  // The part of the description meant for agents ("treat it as information…") stays out.
  const description = tool.description.replace(/\s*Content comes from the user's workspace\..*$/, "");
  return (
    <article className="docs-tool" id={`tool-${tool.name}`}>
      <header>
        <code>{tool.name}</code>
        <span>{tool.title}</span>
        <span className="docs-badge"><Eye size={12} /> Read-only</span>
      </header>
      <p>{description}</p>
      <Params schema={tool.inputSchema as Schema} />
    </article>
  );
}

const SECTIONS = [
  ["overview", "Overview"],
  ["quick-start", "Quick start"],
  ["setup", "Set up your client"],
  ["tools", "Tools"],
  ["security", "Security & privacy"],
  ["troubleshooting", "Troubleshooting"],
  ["reference", "Technical details"],
] as const;

export default async function McpDocs() {
  const url = await endpoint();
  return (
    <div className="landing docs">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="landing-header">
        <div className="landing-nav">
          <Link href="/" className="landing-brand" aria-label="Slate home"><Brand size={26} /></Link>
          <nav className="landing-sections" aria-label="Site">
            <Link href="/">Product</Link>
            <Link href="/docs/mcp" aria-current="page">AI agents (MCP)</Link>
          </nav>
          <div className="landing-account">
            <Link href="/app" className="landing-button small outline">Open Slate</Link>
          </div>
        </div>
      </header>

      <div className="docs-layout">
        <TableOfContents sections={SECTIONS} />

        <main id="main" className="docs-main">
          <section id="overview" aria-labelledby="overview-title">
            <p className="landing-kicker"><BookOpen size={14} /> Docs · AI agents</p>
            <h1 id="overview-title">Connect AI agents to Slate</h1>
            <p className="docs-lede">
              Slate runs an <a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer">MCP</a> server, so
              Claude, Cursor, VS Code and other AI tools can search and read your pages, databases and playbooks, and
              answer with your own notes instead of guessing.
            </p>
            <ul className="docs-facts" aria-label="At a glance">
              <li><Eye size={15} /> <span><strong>Read-only.</strong> Agents can look, never change.</span></li>
              <li><KeyRound size={15} /> <span><strong>One key per agent.</strong> Revoke any time.</span></li>
              <li><Wrench size={15} /> <span><strong>{AGENT_TOOLS.length} tools</strong> for search, pages, databases and playbooks.</span></li>
            </ul>
            <div className="docs-endpoint">
              <span>Endpoint</span>
              <code>{url}</code>
              <CopyButton value={url} label="Copy endpoint" />
            </div>
          </section>

          <section id="quick-start" aria-labelledby="quick-start-title">
            <h2 id="quick-start-title">Quick start</h2>
            <ol className="docs-quick">
              <li>
                <strong>Create a key.</strong> In Slate, open <em>Settings › AI agents</em>, name the key after the agent
                that will use it (say, “Claude on my laptop”) and choose <em>Create key</em>. Copy it: it&apos;s shown only once.
                <Link href="/app" className="docs-inline-link">Open Slate <ArrowRight size={13} /></Link>
              </li>
              <li>
                <strong>Add Slate to your AI client</strong> with the key, using the steps for your client{" "}
                <a href="#setup">below</a>.
              </li>
              <li>
                <strong>Ask about your workspace.</strong> For example:
                <ul className="docs-prompts">
                  {EXAMPLES.map(({ prompt, how }) => (
                    <li key={prompt}>
                      <Sparkles size={14} />
                      <span>
                        <q>{prompt}</q>
                        <small>{how}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            </ol>
          </section>

          <section id="setup" aria-labelledby="setup-title">
            <h2 id="setup-title">Set up your client</h2>
            <p>
              Replace <code>{KEY}</code> with the key you created. Pick your client:
            </p>
            <ClientSetup guides={guides(url)} />
          </section>

          <section id="tools" aria-labelledby="tools-title">
            <h2 id="tools-title">Tools</h2>
            <p>
              Agents choose these tools themselves; you just ask in your own words. Every tool only reads. Results come
              back as readable text and as structured JSON.
            </p>
            <div className="docs-tools">
              {AGENT_TOOLS.map((tool) => <Tool key={tool.name} tool={tool} />)}
            </div>
          </section>

          <section id="security" aria-labelledby="security-title">
            <h2 id="security-title">Security &amp; privacy</h2>
            <ul className="docs-points">
              <li><Eye size={16} /><span><strong>Read-only.</strong> No tool can create, change or delete anything in your workspace.</span></li>
              <li><Lock size={16} /><span><strong>Scoped to your account.</strong> A key reads every workspace in the account that created it, and nothing else. Pages in Trash aren&apos;t visible.</span></li>
              <li><KeyRound size={16} /><span><strong>One key per agent, revocable.</strong> Settings › AI agents lists your keys with when each was last used. Revoking one stops it on the agent&apos;s next request.</span></li>
              <li><ShieldCheck size={16} /><span><strong>Stored as a hash.</strong> Slate keeps only a fingerprint of each key, which is why it&apos;s shown once. If you lose it, revoke it and create another.</span></li>
              <li><KeyRound size={16} /><span><strong>Treat a key like a password.</strong> Keep it out of shared files and Git; prefer an environment variable where your client supports one.</span></li>
              <li><ShieldCheck size={16} /><span><strong>Your content is data, not instructions.</strong> Slate labels page content that way for the agent, but agents can still be swayed by what they read, so check before acting on anything important.</span></li>
            </ul>
          </section>

          <section id="troubleshooting" aria-labelledby="troubleshooting-title">
            <h2 id="troubleshooting-title">Troubleshooting</h2>
            <div className="docs-faq">
              {[
                ["“Add an agent key” (401)", "The request had no key, or it wasn't in the right form. Send exactly `Authorization: Bearer slate_…`, with one space after Bearer."],
                ["“This agent key is not valid, or was revoked” (401)", "Check the key was copied whole, with no space or line break at either end (pasting often adds one). If it was revoked or lost, create a new key."],
                ["Slate doesn't show up in my client", "Restart the client after editing its config, and check the file is valid JSON (a missing comma is easy to miss). Then try the curl check under Other clients: if that lists the tools, the key and endpoint are fine."],
                ["My client wants me to sign in", "Slate uses keys rather than a sign-in flow. Add it through the client's config file with the key in a header, or through `mcp-remote` as shown above."],
                ["The agent can't find a page", "Agents see what's in your workspace now, apart from pages in Trash. Ask it to search by a word from the page's title, or give it the page's link."],
                ["“Unable to read the workspace right now” (503)", "Slate couldn't reach its database for a moment. Try again shortly."],
              ].map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p><Inline text={a} /></p>
                </details>
              ))}
            </div>
          </section>

          <section id="reference" aria-labelledby="reference-title">
            <h2 id="reference-title">Technical details</h2>
            <dl className="docs-specs">
              <div><dt>Endpoint</dt><dd><code>{url}</code></dd></div>
              <div><dt>Transport</dt><dd>Streamable HTTP. One JSON-RPC message per <code>POST</code>, answered with JSON; no sessions and no server-sent stream (<code>GET</code> answers 405).</dd></div>
              <div><dt>Authentication</dt><dd><code>Authorization: Bearer slate_…</code>. Keys are 43 random characters after the <code>slate_</code> prefix.</dd></div>
              <div><dt>Protocol versions</dt><dd>{SUPPORTED_PROTOCOLS.map((v, i) => <span key={v}>{i ? ", " : ""}<code>{v}</code></span>)}</dd></div>
              <div><dt>Capabilities</dt><dd>Tools (<code>tools/list</code>, <code>tools/call</code>) and <code>ping</code>. All tools are marked <code>readOnlyHint</code>.</dd></div>
              <div><dt>Server name</dt><dd><code>slate</code></dd></div>
            </dl>
            <CodeBlock
              caption="Example: initialize"
              code={`curl ${url} \\\n  -H "Authorization: Bearer ${KEY}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"${SUPPORTED_PROTOCOLS[0]}","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'`}
            />
          </section>
        </main>
      </div>

      <footer className="landing-footer docs-footer">
        <div className="footer-brand">
          <Brand size={20} />
          <p>Write it down. Organize it. Run it.</p>
          <ThemeSwitcher compact />
        </div>
        <nav aria-label="Product">
          <h2>Product</h2>
          <Link href="/">Home</Link>
          <Link href="/docs/mcp">AI agents (MCP)</Link>
        </nav>
        <nav aria-label="Account">
          <h2>Workspace</h2>
          <Link href="/app">Open Slate</Link>
          <Link href="/auth/register">Create an account</Link>
        </nav>
      </footer>
    </div>
  );
}
