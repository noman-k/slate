import { describe, expect, it } from "vitest";
import { createSeedState, SEED_IDS } from "./fixtures/seed";
import { planEdit } from "../src/lib/agent-edits";
import { planCreation } from "../src/lib/agent-writes";
import { ToolError } from "../src/lib/agent-tools";
import { handleMcpMessage } from "../src/lib/mcp";
import { mergeStates } from "../src/lib/merge";
import type { WorkspaceState } from "../src/lib/types";

let n = 0;
const ids = () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;
const edit = (state: WorkspaceState, name: string, args: Record<string, unknown>) => planEdit(state, name, args, ids);
const fails = (fn: () => unknown, message: RegExp) => {
  expect(fn).toThrow(ToolError);
  expect(fn).toThrow(message);
};
const doc = (state: WorkspaceState, pageId: string) => state.documents.find((d) => d.page_id === pageId)!;

describe("update_page", () => {
  it("replaces exact passages, appends, and guards against edits made since reading", () => {
    const state = createSeedState();
    const planned = edit(state, "update_page", {
      page_id: SEED_IDS.guide,
      title: "Welcome",
      replace: [{ find: "Make yourself at home", replace_with: "Welcome to Slate" }],
      append: "## Next\n\n- Invite nobody: it's private",
    });
    const changed = planned.edit.documents[0];
    expect(changed.markdown).toContain("# Welcome to Slate");
    expect(changed.markdown.trimEnd().endsWith("- Invite nobody: it's private")).toBe(true);
    // Only if nobody changed it since: the database compares this timestamp.
    expect(changed.expected_updated_at).toBe(doc(state, SEED_IDS.guide).updated_at);
    expect(planned.edit.pages).toEqual([{ id: SEED_IDS.guide, title: "Welcome" }]);
    expect(planned.result.text).toContain("Updated “Welcome”");
  });

  it("asks for a passage that appears exactly once", () => {
    const state = createSeedState();
    fails(() => edit(state, "update_page", { page_id: SEED_IDS.guide, replace: [{ find: "not in the page", replace_with: "x" }] }), /isn't in the page's text/);
    fails(() => edit(state, "update_page", { page_id: SEED_IDS.guide, replace: [{ find: "page", replace_with: "x" }] }), /appears \d+ times/);
  });

  it("never adds or removes embedded blocks, and won't rewrite a page that has them", () => {
    const state = createSeedState();
    const embed = ':::slate {"kind":"page","id":"' + SEED_IDS.log + '"}';
    doc(state, SEED_IDS.hub).markdown += `\n${embed}\n\nAfter the embed.\n`;
    fails(() => edit(state, "update_page", { page_id: SEED_IDS.hub, content: "All new" }), /embedded subpages or databases/);
    fails(() => edit(state, "update_page", { page_id: SEED_IDS.hub, replace: [{ find: embed, replace_with: "" }] }), /embedded block/);
    // Text around it can change, and agent text can't smuggle one in.
    const ok = edit(state, "update_page", { page_id: SEED_IDS.hub, replace: [{ find: "After the embed.", replace_with: "Still here." }] });
    expect(ok.edit.documents[0].markdown).toContain(embed);
    const smuggled = edit(state, "update_page", { page_id: SEED_IDS.guide, append: ':::slate {"kind":"database","id":"x"}\nHello' });
    expect(smuggled.edit.documents[0].markdown).not.toContain(":::slate");
  });

  it("sends databases and playbooks to their own tools, and renames a row's title column too", () => {
    const state = createSeedState();
    fails(() => edit(state, "update_page", { page_id: SEED_IDS.ledger, append: "x" }), /update_database/);
    const playbook = planCreation(state, "create_playbook", { title: "Check", sections: [{ title: "Do", steps: [{ type: "check", text: "It" }, { type: "finish", text: "Done" }] }] }, ids);
    const withPlaybook = { ...state, pages: [...state.pages, { ...playbook.creation.pages[0], favorite: false, deleted_at: null, created_at: "", updated_at: "" }], documents: [...state.documents, { ...playbook.creation.documents[0], updated_at: "" }] } as WorkspaceState;
    fails(() => edit(withPlaybook, "update_page", { page_id: playbook.pageId, append: "x" }), /update_playbook/);
    const row = state.records.find((r) => r.database_id === SEED_IDS.database)!;
    const renamed = edit(state, "update_page", { page_id: row.page_id, title: "2026-04 — Renamed" });
    const titleProperty = state.properties.find((p) => p.database_id === SEED_IDS.database && p.type === "title")!;
    expect(renamed.edit.values).toEqual([{ record_id: row.id, property_id: titleProperty.id, value: "2026-04 — Renamed" }]);
  });
});

describe("update_database", () => {
  it("adds columns and rows, changes values by name, and adds new choices", () => {
    const state = createSeedState();
    const row = state.records.find((r) => r.database_id === SEED_IDS.database)!;
    const planned = edit(state, "update_database", {
      database: "Rent Ledger",
      add_properties: [{ name: "Notes", type: "text" }],
      add_rows: [{ "Rent Entry": "2026-12 — Basement", Status: "Pending", Notes: "New lease" }],
      update_rows: [{ row_id: row.id, values: { Status: "Waived", "Amount Received": 1250 } }],
    });
    const { edit: e } = planned;
    expect(e.new_properties.map((p) => p.name)).toEqual(["Notes"]);
    expect(e.new_records).toHaveLength(1);
    expect(e.new_pages[0]).toMatchObject({ parent_id: SEED_IDS.ledger, title: "2026-12 — Basement" });
    const status = state.properties.find((p) => p.database_id === SEED_IDS.database && p.name === "Status")!;
    expect(e.values).toContainEqual({ record_id: row.id, property_id: status.id, value: "Waived" });
    // "Waived" wasn't a choice yet: it's added to the column.
    expect(e.property_configs.find((c) => c.id === status.id)?.config.options).toContain("Waived");
    expect(planned.result.data).toMatchObject({ new_rows: [{ id: e.new_records[0].id }] });
  });

  it("explains what can't be set", () => {
    const state = createSeedState();
    fails(() => edit(state, "update_database", { database: "Rent Ledger", add_rows: [{ Colour: "red" }] }), /isn't a property/);
    fails(() => edit(state, "update_database", { database: "Rent Ledger", add_rows: [{ Tenant: "x" }] }), /relation property/);
    fails(() => edit(state, "update_database", { database: "Rent Ledger", update_rows: [{ row_id: "nope", values: {} }] }), /no row/);
    fails(() => edit(state, "update_database", { database: "Nope" }), /no database/);
    fails(() => edit(state, "update_database", { database: "Rent Ledger" }), /Nothing to change/);
  });
});

describe("update_playbook and trash_page", () => {
  it("rewrites a playbook's steps, checked like a new one", () => {
    const state = createSeedState();
    const made = planCreation(state, "create_playbook", { title: "Check", sections: [{ title: "Do", steps: [{ type: "check", text: "It" }, { type: "finish", text: "Done" }] }] }, ids);
    const withPlaybook = { ...state, pages: [...state.pages, { ...made.creation.pages[0], favorite: false, deleted_at: null, created_at: "", updated_at: "" }], documents: [...state.documents, { ...made.creation.documents[0], updated_at: "t1" }] } as WorkspaceState;
    const planned = edit(withPlaybook, "update_playbook", {
      page_id: made.pageId,
      when_to_use: "Every Monday",
      sections: [{ title: "Do", steps: [{ type: "check", text: "Lock up" }, { type: "check", text: "Lights off" }, { type: "finish", text: "Done" }] }],
    });
    expect(planned.edit.documents[0]).toMatchObject({ page_id: made.pageId, expected_updated_at: "t1" });
    expect(planned.edit.documents[0].markdown).toContain("Lights off");
    expect(planned.edit.pages[0]).toMatchObject({ description: "When to use: Every Monday" });
    fails(() => edit(withPlaybook, "update_playbook", { page_id: made.pageId, sections: [{ title: "Do", steps: [{ type: "decide", value: "nothing", then_go_to: "Nowhere" }] }] }), /sections are/);
    fails(() => edit(state, "update_playbook", { page_id: SEED_IDS.guide, sections: [] }), /isn't a playbook/);
  });

  it("moves a page and everything inside it to the Trash", () => {
    const state = createSeedState();
    const planned = edit(state, "trash_page", { page_id: SEED_IDS.hub });
    const trashed = planned.edit.pages.map((p) => p.id);
    expect(trashed).toContain(SEED_IDS.hub);
    expect(trashed).toContain(SEED_IDS.log);
    expect(trashed).toContain(SEED_IDS.ledger);
    expect(planned.edit.pages.every((p) => p.trash)).toBe(true);
    expect(planned.result.text).toContain("can be restored");
  });
});

describe("tools offered by permission", () => {
  const list = async (scope: "read" | "write" | "edit") => {
    const reply = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { load: async () => createSeedState(), scope, create: async () => "u", edit: async () => "u" },
    );
    return ((reply.body!.result as { tools: { name: string }[] }).tools).map((t) => t.name);
  };
  it("only edit gets the edit tools; write can't call them", async () => {
    expect(await list("read")).not.toContain("create_page");
    expect(await list("write")).toContain("create_page");
    expect(await list("write")).not.toContain("update_page");
    expect(await list("edit")).toEqual(expect.arrayContaining(["create_page", "update_page", "update_database", "update_playbook", "trash_page"]));
    const refused = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "update_page", arguments: { page_id: SEED_IDS.guide, title: "x" } } },
      { load: async () => createSeedState(), scope: "write", create: async () => "u" },
    );
    expect(JSON.stringify(refused.body)).toContain("can't change existing pages");
  });
});

describe("merging a tab's changes with changes saved elsewhere", () => {
  it("keeps both when they touch different things, and this tab's when they touch the same", () => {
    const base = createSeedState();
    const local = structuredClone(base);
    const remote = structuredClone(base);
    doc(local, SEED_IDS.guide).markdown = "Mine";
    local.pages.find((p) => p.id === SEED_IDS.log)!.title = "My title";
    doc(remote, SEED_IDS.hub).markdown = "The agent's";
    remote.pages.find((p) => p.id === SEED_IDS.log)!.title = "Agent title";
    remote.pages.push({ ...remote.pages[0], id: "new-page", title: "Made by an agent" });
    const { state, overlaps } = mergeStates(base, local, remote);
    expect(doc(state, SEED_IDS.guide).markdown).toBe("Mine");
    expect(doc(state, SEED_IDS.hub).markdown).toBe("The agent's");
    expect(state.pages.find((p) => p.id === "new-page")?.title).toBe("Made by an agent");
    expect(state.pages.find((p) => p.id === SEED_IDS.log)?.title).toBe("My title");
    expect(overlaps).toEqual([SEED_IDS.log]);
  });

  it("keeps deletions from either side", () => {
    const base = createSeedState();
    const local = { ...base, pages: base.pages.filter((p) => p.id !== SEED_IDS.guide) };
    const remote = { ...base, documents: base.documents.filter((d) => d.page_id !== SEED_IDS.hub) };
    const { state } = mergeStates(base, local, remote);
    expect(state.pages.some((p) => p.id === SEED_IDS.guide)).toBe(false);
    expect(state.documents.some((d) => d.page_id === SEED_IDS.hub)).toBe(false);
  });
});
