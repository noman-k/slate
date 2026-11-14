import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { ArrowRight, BookOpen, Eye, KeyRound, Lock, PlusCircle, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { AGENT_TOOLS, type ToolDefinition } from "@/lib/agent-tools";
import { WRITE_TOOLS } from "@/lib/agent-writes";
import { SUPPORTED_PROTOCOLS } from "@/lib/mcp";
import { REPOSITORY_URL } from "@/lib/project";
import { LIMITS } from "@/lib/rate-limit";
import { ClientSetup, CodeBlock, CopyButton, Inline, TableOfContents, type ClientGuide } from "./client-setup";
import "../../landing.css";
import "../docs.css";

export const metadata: Metadata = {
  title: "Connect AI agents (MCP) · Slate",
  description:
    "Connect Claude, ChatGPT, Codex, Cursor or any MCP client to your Slate workspace by signing in: it reads your pages, databases and playbooks and, if you allow it, creates new ones.",
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
      id: "claude",
      name: "Claude",
      steps: [
        {
          text: "In Claude (the desktop app or claude.ai), go to **Customize › Connectors**, choose **Add**, then **Add custom connector**. Name it Slate and paste this address:",
          caption: "Remote MCP server URL",
          code: url,
        },
        { text: "Choose **Add**, then **Connect**. Slate opens: sign in, pick the workspace and what Claude can do, and choose **Allow access**." },
        { text: "In a chat, open **+ › Connectors** and check that Slate is on." },
      ],
      note: "Leave the connector's advanced settings as they are: Claude registers itself with Slate. On Team and Enterprise plans an owner adds the connector under Organization settings › Connectors first; then each person connects their own workspace.",
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      steps: [
        { text: "In ChatGPT, open **Settings › Apps & Connectors › Advanced** and turn on **Developer mode**." },
        {
          text: "Back in **Apps & Connectors**, create a connector named Slate with this URL, and choose **OAuth** for authentication:",
          caption: "MCP server URL",
          code: url,
        },
        { text: "Slate opens: sign in, pick the workspace and what ChatGPT can do, and choose **Allow access**. Then turn Slate on in a chat from the **+** menu." },
      ],
      note: "Developer mode depends on your ChatGPT plan, and where it lives in Settings can change; OpenAI's Developer mode guide has the current steps.",
    },
    {
      id: "claude-code",
      name: "Claude Code",
      steps: [
        { text: "Add Slate in a terminal:", caption: "Terminal", code: `claude mcp add --transport http slate ${url}` },
        { text: "Start Claude Code, run `/mcp`, choose slate and **Authenticate**. Your browser opens Slate: sign in and choose **Allow access**." },
      ],
      note: `Add \`--scope user\` to use Slate in every project. Rather use a key? Add \`--header "Authorization: Bearer ${KEY}"\` to the command.`,
    },
    {
      id: "codex",
      name: "Codex",
      steps: [
        {
          text: "Add Slate to `~/.codex/config.toml`:",
          caption: "~/.codex/config.toml",
          code: `[mcp_servers.slate]\nurl = "${url}"`,
        },
        { text: "Sign in from a terminal. Your browser opens Slate: choose the workspace and **Allow access**.", caption: "Terminal", code: "codex mcp login slate" },
      ],
      note: "The same file is used by the Codex CLI, the IDE extension and the desktop app. To use a key instead, add `bearer_token_env_var = \"SLATE_API_KEY\"` under `[mcp_servers.slate]` and set `SLATE_API_KEY` in your environment.",
    },
    {
      id: "cursor",
      name: "Cursor",
      steps: [
        {
          text: "Open `~/.cursor/mcp.json` (every project) or `.cursor/mcp.json` (this project only) and add Slate:",
          caption: "mcp.json",
          code: JSON.stringify({ mcpServers: { slate: { url } } }, null, 2),
        },
        { text: "In Cursor's MCP settings, choose **Connect** (or **Needs login**) next to slate. Your browser opens Slate: choose **Allow access**." },
      ],
      note: `Rather use a key? Add \`"headers": { "Authorization": "Bearer ${KEY}" }\` next to the url.`,
    },
    {
      id: "vscode",
      name: "VS Code",
      steps: [
        {
          text: "Create `.vscode/mcp.json` in your project (or run **MCP: Add Server** and choose HTTP):",
          caption: ".vscode/mcp.json",
          code: JSON.stringify({ servers: { slate: { type: "http", url } } }, null, 2),
        },
        { text: "Start the server from the file or from **MCP: List Servers**. VS Code asks to sign in: allow it, then choose **Allow access** on Slate's page." },
      ],
      note: `To use a key instead, add \`"headers": { "Authorization": "Bearer \${env:SLATE_API_KEY}" }\` and set \`SLATE_API_KEY\` in the environment VS Code starts from.`,
    },
    {
      id: "other",
      name: "Other clients",
      steps: [
        {
          text: "Point any client that supports remote MCP servers over Streamable HTTP at the address. If it can sign in (OAuth), it finds everything it needs from there:",
          caption: "Connection",
          code: url,
        },
        {
          text: "A client that can't sign in sends a key instead, in the `Authorization` header:",
          caption: "Header",
          code: `Authorization: Bearer ${KEY}`,
        },
        {
          text: "For a client that only runs local (stdio) servers, start Slate through `mcp-remote` (it signs in for you):",
          caption: "Command",
          code: `npx mcp-remote ${url}`,
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
  { prompt: "Turn these meeting notes into a page under Projects.", how: "Creates a page (with a key that can create)." },
  { prompt: "Make a database of my vendors with name, phone and contract end date.", how: "Creates a database with those columns and rows." },
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
        {tool.annotations.readOnlyHint ? (
          <span className="docs-badge"><Eye size={12} /> Read-only</span>
        ) : (
          <span className="docs-badge is-create"><PlusCircle size={12} /> Creates</span>
        )}
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
      <SiteHeader current="/docs/mcp" />

      <div className="docs-layout">
        <TableOfContents sections={SECTIONS} />

        <main id="main" className="docs-main">
          <section id="overview" aria-labelledby="overview-title">
            <p className="landing-kicker"><BookOpen size={14} /> Docs · AI agents</p>
            <h1 id="overview-title">Connect AI agents to Slate</h1>
            <p className="docs-lede">
              Slate runs an <a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer">MCP</a> server, so
              Claude, ChatGPT, Codex, Cursor and other AI tools can search and read your pages, databases and playbooks,
              and answer with your own notes instead of guessing. Add Slate&apos;s address to your app and sign in: no key
              to copy.
            </p>
            <ul className="docs-facts" aria-label="At a glance">
              <li><Eye size={15} /> <span><strong>Read-only by default.</strong> A key can also create; nothing ever edits or deletes.</span></li>
              <li><KeyRound size={15} /> <span><strong>Sign in to connect.</strong> One workspace per app; disconnect any time.</span></li>
              <li><Wrench size={15} /> <span><strong>{AGENT_TOOLS.length + WRITE_TOOLS.length} tools</strong>: {AGENT_TOOLS.length} to read, {WRITE_TOOLS.length} to create.</span></li>
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
                <strong>Add Slate to your app.</strong> Give it this address, using the steps for your app{" "}
                <a href="#setup">below</a>: <code className="docs-break">{url}</code>
              </li>
              <li>
                <strong>Sign in and allow it.</strong> The app opens Slate. Pick the workspace it should use and what it can
                do (<em>Read only</em>, or <em>Read and create</em> to let it add pages, databases and playbooks), then choose{" "}
                <em>Allow access</em>.
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
            <p>Pick your app. Each one signs in to Slate the first time it connects.</p>
            <ClientSetup guides={guides(url)} />
            <h3 id="keys" className="docs-tools-group">Apps that can&apos;t sign in: use a key</h3>
            <p>
              In Slate, switch to the workspace the agent should use and open <em>Settings › AI agents</em>. Name the key
              after the agent (say, “Claude on my laptop”), choose what it can do and choose <em>Create key</em>. Copy it:
              it&apos;s shown only once. Then send it as <code>Authorization: Bearer {KEY}</code>; each app&apos;s tab
              above says where.
              <Link href="/app" className="docs-inline-link">Open Slate <ArrowRight size={13} /></Link>
            </p>
          </section>

          <section id="tools" aria-labelledby="tools-title">
            <h2 id="tools-title">Tools</h2>
            <p>
              Agents choose these tools themselves; you just ask in your own words. Results come back as readable text and
              as structured JSON.
            </p>
            <h3 className="docs-tools-group">Reading (every app and key)</h3>
            <div className="docs-tools">
              {AGENT_TOOLS.map((tool) => <Tool key={tool.name} tool={tool} />)}
            </div>
            <h3 className="docs-tools-group">Creating (apps and keys allowed to “Read and create”)</h3>
            <p>
              These only add. A new page or playbook can go inside an existing page, where it appears as a link at the end of
              that page; nothing else that exists is changed, and nothing is deleted. A playbook is checked the way the
              builder checks it, and anything that would break a run comes back as an error to fix before it&apos;s made.
              Each answer includes the new page&apos;s address.
            </p>
            <div className="docs-tools">
              {WRITE_TOOLS.map((tool) => <Tool key={tool.name} tool={tool} />)}
            </div>
          </section>

          <section id="security" aria-labelledby="security-title">
            <h2 id="security-title">Security &amp; privacy</h2>
            <ul className="docs-points">
              <li><Eye size={16} /><span><strong>Read-only unless you choose otherwise.</strong> Apps and keys can only read unless you choose <em>Read and create</em>. Even then, agents only add new pages, databases and playbooks: no tool edits or deletes anything.</span></li>
              <li><PlusCircle size={16} /><span><strong>Limits on creating.</strong> An app or key can create at most 20 things a minute, and one database at most 200 rows at once. Agent text is kept as text: it can&apos;t embed other pages or databases.</span></li>
              <li><Lock size={16} /><span><strong>Scoped to one workspace.</strong> An app opens only the workspace you picked when you allowed it, and a key only the workspace it was made in: never your other workspaces or anyone else&apos;s. Pages in Trash aren&apos;t visible.</span></li>
              <li><KeyRound size={16} /><span><strong>Disconnect any time.</strong> Settings › AI agents lists the workspace&apos;s connected apps and keys with when each was last used. Disconnecting an app or revoking a key stops it on its next request.</span></li>
              <li><ShieldCheck size={16} /><span><strong>Signing in, not sharing a secret.</strong> A connected app gets an access token that lasts an hour and is renewed as it&apos;s used; your password never reaches the app. Slate uses OAuth 2.1 with PKCE, and only sends people back to an address the app registered.</span></li>
              <li><ShieldCheck size={16} /><span><strong>Stored as a hash.</strong> Slate keeps only a fingerprint of each key and token, which is why a key is shown once. If you lose it, revoke it and create another.</span></li>
              <li><KeyRound size={16} /><span><strong>Treat a key like a password.</strong> Keep it out of shared files and Git; prefer an environment variable where your client supports one.</span></li>
              <li><ShieldCheck size={16} /><span><strong>Your content is data, not instructions.</strong> Slate labels page content that way for the agent, but agents can still be swayed by what they read, so check before acting on anything important.</span></li>
            </ul>
          </section>

          <section id="troubleshooting" aria-labelledby="troubleshooting-title">
            <h2 id="troubleshooting-title">Troubleshooting</h2>
            <div className="docs-faq">
              {[
                ["The app says it couldn't connect, or sign-in didn't open", "Check the address is exactly the one above, ending in /api/mcp. Remove the connector and add it again: the app registers itself with Slate again and opens the sign-in page."],
                ["I chose the wrong workspace", "Disconnect the app in that workspace's Settings › AI agents, then connect it again from the app and pick the right one."],
                ["“Connect this app by signing in” (401)", "The request had no sign-in or key. Apps that can sign in do it from there; with a key, send exactly `Authorization: Bearer slate_…`, with one space after Bearer."],
                ["“Not valid, has expired, or was revoked” (401)", "An app renews its sign-in by itself; if it was disconnected, connect it again. For a key, check it was copied whole, with no space or line break at either end. If it was revoked or lost, create a new key."],
                ["Slate doesn't show up in my client", "Restart the client after editing its config, and check the file is valid JSON (a missing comma is easy to miss). With a key, try the curl check under Other clients: if that lists the tools, the key and endpoint are fine."],
                ["The agent can't find a page", "Agents see what's in your workspace now, apart from pages in Trash. Ask it to search by a word from the page's title, or give it the page's link."],
                ["“Unable to read the workspace right now” (503)", "Slate couldn't reach its database for a moment. Try again shortly."],
                ["“This agent key can only read”", "It was allowed Read only. Disconnect the app (or revoke the key) in Settings › AI agents and connect again choosing Read and create."],
                ["A new page doesn't show in Slate yet", "Slate checks for changes every few seconds while the tab is open, and right away when you come back to it. If you were in the middle of editing, it waits until your changes are saved."],
                ["“Too many requests” (429)", `Each app or key can make ${LIMITS.MCP_KEY_LIMITER} requests a minute, and each address ${LIMITS.MCP_IP_LIMITER}. Wait the number of seconds in the \`Retry-After\` header (the message says it too), then carry on. Normal use never gets near this.`],
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
              <div><dt>Authentication</dt><dd>OAuth 2.1 per the MCP authorization spec: a <code>401</code> carries <code>WWW-Authenticate</code> with <code>resource_metadata</code>; authorization code with PKCE (<code>S256</code>), public clients, Dynamic Client Registration, rotating refresh tokens. Scopes <code>read</code> and <code>write</code>. Or an agent key: <code>Authorization: Bearer slate_…</code>, 43 random characters after the prefix.</dd></div>
              <div><dt>Discovery</dt><dd><code>/.well-known/oauth-protected-resource</code> and <code>/.well-known/oauth-authorization-server</code></dd></div>
              <div><dt>Protocol versions</dt><dd>{SUPPORTED_PROTOCOLS.map((v, i) => <span key={v}>{i ? ", " : ""}<code>{v}</code></span>)}</dd></div>
              <div><dt>Capabilities</dt><dd>Tools (<code>tools/list</code>, <code>tools/call</code>) and <code>ping</code>. A key sees the reading tools (<code>readOnlyHint</code>), plus the creating ones (<code>readOnlyHint: false</code>, <code>destructiveHint: false</code>) when its scope allows.</dd></div>
              <div><dt>Rate limits</dt><dd>{LIMITS.MCP_KEY_LIMITER} requests a minute per key and {LIMITS.MCP_IP_LIMITER} per IP address; creating, {LIMITS.MCP_WRITE_LIMITER} a minute per key. Over a limit: <code>429</code> with <code>Retry-After</code>.</dd></div>
              <div><dt>Server name</dt><dd><code>slate</code></dd></div>
              <div><dt>Source</dt><dd>The server is <code>src/app/api/mcp</code> and <code>src/lib/mcp.ts</code>; the tools are <code>src/lib/agent-tools.ts</code> in the <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">GitHub repository</a>.</dd></div>
            </dl>
            <CodeBlock
              caption="Example: initialize"
              code={`curl ${url} \\\n  -H "Authorization: Bearer ${KEY}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"${SUPPORTED_PROTOCOLS[0]}","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'`}
            />
          </section>
        </main>
      </div>

      <SiteFooter />
    </div>
  );
}
