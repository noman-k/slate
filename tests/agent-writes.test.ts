import { describe, expect, it, vi } from "vitest";
import { createSeedState, SEED_IDS } from "./fixtures/seed";
import { planCreation, plainMarkdown, WRITE_TOOLS } from "../src/lib/agent-writes";
import { ToolError } from "../src/lib/agent-tools";
import { handleMcpMessage } from "../src/lib/mcp";
import { parseProcedure } from "../src/lib/runner";
import { checkPlaybook } from "../src/lib/playbook-checks";
import { parsePlaybook } from "../src/lib/playbook-model";

let n = 0;
const ids = () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;
const plan = (name: string, args: Record<string, unknown>) => planCreation(createSeedState(), name, args, ids);

describe("create_page", () => {
  it("adds a top-level page with its text", () => {
    const { creation, pageId, result } = plan("create_page", { title: "Trip ideas", content: "# Lisbon\n\n- [ ] Book flights" });
    expect(creation.pages).toEqual([expect.objectContaining({ id: pageId, title: "Trip ideas", kind: "document", parent_id: null })]);
    expect(creation.documents).toEqual([{ page_id: pageId, markdown: "# Lisbon\n\n- [ ] Book flights\n" }]);
    expect(creation.appends).toEqual([]);
    expect(result.text).toContain("at the top level");
  });
  it("puts a page inside another, linked at the end of the parent's text", () => {
    const { creation, pageId } = plan("create_page", { title: "Notes", parent_page_id: SEED_IDS.hub });
    expect(creation.pages[0]).toMatchObject({ parent_id: SEED_IDS.hub });
    expect(creation.appends).toEqual([{ page_id: SEED_IDS.hub, text: `:::slate {"kind":"page","id":"${pageId}"}` }]);
  });
  it("keeps agent text as text: embed and step lines are dropped", () => {
    expect(plainMarkdown(`Hi\n:::slate {"kind":"database","id":"x"}\n:::slate-node {"type":"procedureStep"}\nBye`)).toBe("Hi\nBye");
  });
  it("explains what's wrong", () => {
    expect(() => plan("create_page", {})).toThrow("Add a title.");
    expect(() => plan("create_page", { title: "x", parent_page_id: "nope" })).toThrow(/no page with the id/);
    expect(() => plan("create_page", { title: "x", parent_page_id: SEED_IDS.ledger })).toThrow(/is a database/);
  });
});

describe("create_database", () => {
  it("creates typed properties, rows and a view", () => {
    const { creation, result } = plan("create_database", {
      title: "Units",
      properties: [
        { name: "Rent", type: "currency" },
        { name: "Occupied", type: "checkbox" },
        { name: "Floor", type: "select", options: ["Ground"] },
        { name: "Since", type: "date" },
      ],
      rows: [
        { Name: "Unit 1A", Rent: 1300, Occupied: true, Floor: "Ground", Since: "2026-01-01" },
        { name: "Unit 2B", rent: "1450", floor: "Upper" },
      ],
      view: "board",
    });
    const [title, rent, , floor] = creation.properties;
    expect(title).toMatchObject({ name: "Name", type: "title", position: 0 });
    expect(floor.config.options).toEqual(["Ground", "Upper"]);
    expect(creation.records).toHaveLength(2);
    expect(creation.records[1].values[rent.id]).toBe(1450);
    expect(creation.pages.filter((p) => p.kind === "document").map((p) => p.title)).toEqual(["Unit 1A", "Unit 2B"]);
    expect(creation.views[0]).toMatchObject({ type: "board", group_by: floor.id });
    expect(result.text).toContain("5 properties and 2 rows");
  });
  it("gives a simple Status column when no properties are given", () => {
    const { creation } = plan("create_database", { title: "Tasks" });
    expect(creation.properties.map((p) => p.name)).toEqual(["Name", "Status"]);
  });
  it("rejects values that don't fit, naming the row", () => {
    expect(() => plan("create_database", { title: "x", properties: [{ name: "N", type: "number" }], rows: [{ N: "lots" }] })).toThrow(
      "“N” in row 1 must be a number.",
    );
    expect(() => plan("create_database", { title: "x", rows: [{ Colour: "red" }] })).toThrow(/isn't a property/);
    expect(() => plan("create_database", { title: "x", properties: [{ name: "Name", type: "text" }] })).toThrow(/Two properties/);
  });
});

describe("create_playbook", () => {
  const refund = {
    title: "Refund request",
    when_to_use: "A customer asks for their money back.",
    inputs: [
      { label: "Order number" },
      { label: "Days since delivery", type: "number" },
    ],
    guidelines: ["Apologize once."],
    sections: [
      {
        title: "Check eligibility",
        steps: [{ type: "decide", value: "Days since delivery", is: "lt", compare_to: "31", otherwise_go_to: "Offer credit" }],
      },
      {
        title: "Refund",
        steps: [
          { type: "check", text: "Refund order {{order_number}}.", expect: "It shows as pending" },
          { type: "finish", text: "Refunded" },
        ],
      },
      {
        title: "Offer credit",
        steps: [
          { type: "ask", text: "Does the customer accept store credit?", answer: "yesno", save_as: "accepts" },
          { type: "decide", value: "accepts", compare_to: "Yes", otherwise_go_to: "finish" },
          { type: "say", text: "Store credit for {{order_number}} is ready." },
          { type: "finish", text: "Credit issued" },
        ],
      },
    ],
  };
  it("builds a runnable playbook the builder accepts", () => {
    const { creation, result } = plan("create_playbook", refund);
    const markdown = creation.documents[0].markdown;
    const procedure = parseProcedure(markdown);
    expect(procedure.params.map((p) => p.name)).toEqual(["order_number", "days_since_delivery"]);
    expect(procedure.sections).toEqual(["Guidelines", "Check eligibility", "Refund", "Offer credit"]);
    expect(procedure.steps.map((s) => s.step)).toEqual(["if", "check", "end", "ask", "if", "send", "end"]);
    expect(procedure.steps[0]).toMatchObject({ variable: "days_since_delivery", op: "lt", value: "31", else: "Offer credit" });
    expect(checkPlaybook(parsePlaybook(markdown)).warnings).toBe(0);
    expect(creation.pages[0]).toMatchObject({ icon: "icon:compass:blue", description: "When to use: A customer asks for their money back." });
    expect(result.data).toMatchObject({ inputs: ["order_number", "days_since_delivery"], steps: 7 });
  });
  it("sends back the builder's problems instead of creating a broken playbook", () => {
    const broken = { title: "x", sections: [{ title: "Start", steps: [{ type: "say", text: "Hi {{customer}}" }] }] };
    expect(() => plan("create_playbook", broken)).toThrow(/wasn't created[\s\S]*“customer”/);
    expect(() => plan("create_playbook", { title: "x", sections: [{ title: "A", steps: [{ type: "decide", value: "v", otherwise_go_to: "Nowhere" }] }] })).toThrow(
      /goes to “Nowhere”, but the sections are: A/,
    );
  });
});

describe("MCP with keys of each scope", () => {
  const state = createSeedState();
  const list = async (access: Parameters<typeof handleMcpMessage>[1]) =>
    ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, access)).body!.result as { tools: { name: string }[] }).tools.map((t) => t.name);
  it("offers create tools only to keys that may create", async () => {
    const read = await list({ load: async () => state, scope: "read" });
    expect(read).not.toContain("create_page");
    const write = await list({ load: async () => state, scope: "write", create: async () => "" });
    expect(write).toEqual(expect.arrayContaining(WRITE_TOOLS.map((t) => t.name)));
    for (const tool of WRITE_TOOLS) expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });
  it("tells a read-only key how to get one that can create", async () => {
    const reply = await handleMcpMessage(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_page", arguments: { title: "x" } } },
      { load: async () => state, scope: "read" },
    );
    const answer = reply.body!.result as { isError: boolean; content: { text: string }[] };
    expect(answer.isError).toBe(true);
    expect(answer.content[0].text).toContain("Read and create");
  });
  it("saves a creation and returns where it is", async () => {
    const create = vi.fn(async () => "https://slate.example/p/abc");
    const reply = await handleMcpMessage(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create_page", arguments: { title: "Hello" } } },
      { load: async () => state, scope: "write", create },
    );
    const answer = reply.body!.result as { isError: boolean; content: { text: string }[]; structuredContent: { url: string } };
    expect(create).toHaveBeenCalledOnce();
    expect(answer.isError).toBe(false);
    expect(answer.structuredContent.url).toBe("https://slate.example/p/abc");
    expect(answer.content[0].text).toContain("Open it: https://slate.example/p/abc");
  });
  it("throws nothing to the agent's tool error path for bad input", async () => {
    const reply = await handleMcpMessage(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "create_database", arguments: {} } },
      { load: async () => state, scope: "write", create: async () => { throw new ToolError("should not be called"); } },
    );
    expect((reply.body!.result as { content: { text: string }[] }).content[0].text).toBe("Add a name for the database.");
  });
});
