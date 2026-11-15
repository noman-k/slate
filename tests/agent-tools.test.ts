import { describe, expect, it } from "vitest";
import { createSeedState, SEED_IDS } from "./fixtures/seed";
import { AGENT_TOOLS, callTool, ToolError, inputsSchema } from "../src/lib/agent-tools";
import { handleMcpMessage } from "../src/lib/mcp";
import { PROCEDURE_TEMPLATES, templateMarkdown } from "../src/lib/procedures";
import { agentKeyPrefix, generateAgentKey, hashAgentKey, looksLikeAgentKey } from "../src/lib/agent-keys";
import type { WorkspaceState } from "../src/lib/types";

/** The demo workspace plus a playbook page and a trashed page. */
function workspace(): WorkspaceState {
  const state = createSeedState();
  const now = new Date().toISOString();
  const page = (id: string, title: string, extra: Partial<WorkspaceState["pages"][number]> = {}) => ({
    id,
    workspace_id: state.active_workspace_id,
    parent_id: null,
    title,
    icon: "",
    kind: "document" as const,
    description: "",
    position: 99,
    favorite: false,
    deleted_at: null,
    created_at: now,
    updated_at: now,
    ...extra,
  });
  const refund = PROCEDURE_TEMPLATES.find((t) => t.id === "playbook-refund")!;
  state.pages.push(
    page("pb-1", "Refund request", { description: refund.whenToUse }),
    page("gone", "Old secret plan", { deleted_at: now }),
  );
  state.documents.push(
    { page_id: "pb-1", markdown: templateMarkdown(refund), updated_at: now },
    { page_id: "gone", markdown: "launch codes", updated_at: now },
  );
  return state;
}

describe("agent tools", () => {
  it("are all read-only and described", () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toEqual([
      "search_workspace",
      "read_page",
      "list_databases",
      "query_database",
      "list_playbooks",
    ]);
    for (const tool of AGENT_TOOLS) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });

  it("search finds pages, records and playbooks — never trashed pages", () => {
    const state = workspace();
    const found = callTool(state, "search_workspace", { query: "refund" }).data as {
      results: { id: string; type: string }[];
    };
    expect(found.results[0]).toMatchObject({ id: "pb-1", type: "playbook" });
    const tenants = callTool(state, "search_workspace", { query: "alex" }).data as {
      results: { type: string; title: string }[];
    };
    expect(tenants.results.some((r) => r.type === "record" && r.title.includes("Alex"))).toBe(true);
    const gone = callTool(state, "search_workspace", { query: "launch codes" }).data as { results: unknown[] };
    expect(gone.results).toHaveLength(0);
    expect(() => callTool(state, "search_workspace", { query: "  " })).toThrow(ToolError);
  });

  it("reads a page as Markdown, with its pages inside", () => {
    const state = workspace();
    const page = callTool(state, "read_page", { page_id: SEED_IDS.hub }).data as {
      title: string;
      content: string;
      pages_inside: { title: string }[];
    };
    expect(page.title).toBe("Rental Property Finance Hub");
    expect(page.pages_inside.map((p) => p.title)).toContain("Tenant Rent Log");
    expect(() => callTool(state, "read_page", { page_id: "gone" })).toThrow(/No page/);
  });

  it("reads a playbook's steps in words, not as stored data", () => {
    const text = callTool(workspace(), "read_page", { page_id: "pb-1" }).text;
    expect(text).toContain("- DECIDE: Refunds are allowed within 30 days of delivery.");
    expect(text).toContain("- CHECK: Refund {{order_total}} for order {{order_number}}");
    expect(text).not.toContain(":::slate-node");
  });

  it("lists databases and queries them by name, with filters and sorting", () => {
    const state = workspace();
    const dbs = callTool(state, "list_databases").data as {
      databases: { name: string; properties: { name: string }[] }[];
    };
    const ledger = dbs.databases.find((d) => d.name === "Rent Ledger")!;
    expect(ledger.properties.length).toBeGreaterThan(2);
    const all = callTool(state, "query_database", { database: "Rent Ledger" }).data as {
      total: number;
      rows: { values: Record<string, unknown> }[];
    };
    expect(all.total).toBeGreaterThan(0);
    const status = ledger.properties.find((p) => /status/i.test(p.name))!.name;
    const paid = callTool(state, "query_database", {
      database: "Rent Ledger",
      filters: [{ property: status, operator: "equals", value: "Paid" }],
      limit: 3,
    }).data as { rows: { values: Record<string, unknown> }[]; total: number };
    expect(paid.rows.length).toBeLessThanOrEqual(3);
    for (const row of paid.rows) expect(String(row.values[status]).toLowerCase()).toBe("paid");
    expect(() => callTool(state, "query_database", { database: "Nope" })).toThrow(/No database/);
    // The id search_workspace gives (the database's page) works too.
    const pageId = state.databases.find((d) => d.name === "Rent Ledger")!.page_id;
    expect((callTool(state, "query_database", { database: pageId }).data as { total: number }).total).toBe(all.total);
    expect(() =>
      callTool(state, "query_database", {
        database: "Rent Ledger",
        filters: [{ property: "Colour", operator: "equals", value: "x" }],
      }),
    ).toThrow(/no property/);
  });

  it("lists playbooks with their inputs as JSON Schema", () => {
    const list = callTool(workspace(), "list_playbooks").data as {
      playbooks: { title: string; when_to_use: string; inputs: { required: string[] } }[];
    };
    expect(list.playbooks).toHaveLength(1);
    expect(list.playbooks[0]).toMatchObject({
      title: "Refund request",
      when_to_use: "a customer asks for their money back on an order.",
    });
    expect(list.playbooks[0].inputs.required).toEqual(["order_number", "order_total", "days_since_delivery"]);
    expect(inputsSchema([{ name: "token", type: "secret", required: true }]).properties.token).toMatchObject({
      writeOnly: true,
    });
  });
});

describe("MCP endpoint protocol", () => {
  const load = async () => workspace();
  it("initializes, lists tools and calls them", async () => {
    const init = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      load,
    );
    expect(init.body?.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "slate" },
    });
    expect((await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, load)).status).toBe(202);
    const list = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, load);
    expect((list.body?.result as { tools: unknown[] }).tools).toHaveLength(5);
    const call = await handleMcpMessage(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_playbooks", arguments: {} } },
      load,
    );
    expect(call.body?.result).toMatchObject({ isError: false, content: [{ type: "text" }] });
  });
  it("reports problems the agent can fix as tool errors, and protocol mistakes as errors", async () => {
    const bad = await handleMcpMessage(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "read_page", arguments: { page_id: "x" } } },
      load,
    );
    expect(bad.body?.result).toMatchObject({ isError: true });
    expect(
      (
        await handleMcpMessage(
          { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "delete_everything" } },
          load,
        )
      ).body?.error,
    ).toMatchObject({ code: -32602 });
    expect(
      (await handleMcpMessage({ jsonrpc: "2.0", id: 6, method: "resources/list" }, load)).body?.error,
    ).toMatchObject({ code: -32601 });
    expect((await handleMcpMessage([{ jsonrpc: "2.0", id: 7, method: "ping" }], load)).body?.error).toMatchObject({
      code: -32600,
    });
  });
});

describe("agent keys", () => {
  it("are long random secrets, stored only as a hash", async () => {
    const a = generateAgentKey();
    const b = generateAgentKey();
    expect(a).not.toBe(b);
    expect(looksLikeAgentKey(a)).toBe(true);
    expect(looksLikeAgentKey("slate_short")).toBe(false);
    expect(await hashAgentKey(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashAgentKey(a)).toBe(await hashAgentKey(a));
    expect(agentKeyPrefix(a)).toHaveLength(10);
  });
});
