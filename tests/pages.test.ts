import { describe, it, expect } from "vitest";
import { duplicatePageSubtree } from "../src/lib/pages";
import { createSeedState, SEED_IDS } from "../src/lib/seed";
import { encodeDirective } from "../src/lib/markdown";
import type { WorkspaceState } from "../src/lib/types";

const now = "2026-11-12T01:00:00.000Z";
const options = () => {
  let sequence = 0;
  return {
    rootId: "copied-root",
    generateId: () => `copied-${++sequence}`,
    now,
  };
};
const databaseFor = (state: WorkspaceState, name: string) =>
  state.databases.find((database) => database.name === name)!;
const propertyFor = (state: WorkspaceState, databaseId: string, name: string) =>
  state.properties.find(
    (property) => property.database_id === databaseId && property.name === name,
  )!;

function relationFixture() {
  const state = createSeedState();
  const tenants = databaseFor(state, "Tenants");
  const tenantRelation = propertyFor(state, SEED_IDS.database, "Tenant");
  tenantRelation.config.reciprocal_property_id = "rent-reciprocal";
  state.properties.push({
    id: "rent-reciprocal",
    database_id: tenants.id,
    name: "Rent payments",
    type: "relation",
    position: 3,
    width: 200,
    config: {
      related_database_id: SEED_IDS.database,
      reciprocal_property_id: tenantRelation.id,
    },
  });
  const tenant = state.records.find(
    (record) => record.database_id === tenants.id,
  )!;
  tenant.values["rent-reciprocal"] = state.records
    .filter((record) => record.database_id === SEED_IDS.database)
    .map((record) => record.id);
  state.properties.push({
    id: "rent-rollup",
    database_id: SEED_IDS.database,
    name: "Tenant count",
    type: "rollup",
    position: 8,
    width: 160,
    config: {
      relation_property_id: tenantRelation.id,
      rollup_property_id: propertyFor(state, tenants.id, "Tenant name").id,
      aggregation: "count",
    },
  });
  const firstRecord = state.records.find(
    (record) => record.database_id === SEED_IDS.database,
  )!;
  state.documents.push({
    page_id: firstRecord.page_id,
    markdown: "## Payment notes\n\nProof of payment attached.",
    updated_at: now,
  });
  return state;
}

describe("recursive page duplication", () => {
  it("duplicates all descendants, documents, records and views without changing originals", () => {
    const state = relationFixture();
    const before = structuredClone(state);
    const result = duplicatePageSubtree(state, SEED_IDS.hub, options());
    expect(state).toEqual(before);
    const originalPageIds = new Set(state.pages.map((page) => page.id));
    const copies = result.pages.filter((page) => !originalPageIds.has(page.id));
    expect(copies).toHaveLength(state.pages.length - 2); // Two sibling notes are outside the hub.
    const root = copies.find((page) => page.id === "copied-root")!;
    expect(root.title).toBe("Rental Property Finance Hub (copy)");
    expect(root.parent_id).toBeNull();
    expect(
      copies
        .filter((page) => page.id !== root.id)
        .every((page) => copies.some((parent) => parent.id === page.parent_id)),
    ).toBe(true);
    expect(result.databases).toHaveLength(state.databases.length * 2);
    expect(result.records).toHaveLength(state.records.length * 2);
    expect(result.views).toHaveLength(state.views.length * 2);
    const copiedRecordPages = new Set(
      result.records
        .slice(state.records.length)
        .map((record) => record.page_id),
    );
    expect(
      result.documents.some(
        (document) =>
          copiedRecordPages.has(document.page_id) &&
          document.markdown.includes("Proof of payment"),
      ),
    ).toBe(true);
    expect(
      copies.every((page) => !page.favorite && page.created_at === now),
    ).toBe(true);
  });

  it("remaps internal database, relation, rollup and view property references to copies", () => {
    const state = relationFixture();
    const originalView = state.views.find(
      (view) => view.database_id === SEED_IDS.database && view.name === "Paid",
    )!;
    Object.assign(originalView, {
      property_order: state.properties
        .filter((property) => property.database_id === SEED_IDS.database)
        .map((property) => property.id)
        .reverse(),
    });
    const result = duplicatePageSubtree(state, SEED_IDS.hub, options());
    const copiedDatabases = result.databases.slice(state.databases.length);
    const rent = copiedDatabases.find(
      (database) => database.name === "Rent Ledger",
    )!;
    const tenants = copiedDatabases.find(
      (database) => database.name === "Tenants",
    )!;
    const relation = propertyFor(result, rent.id, "Tenant");
    const inverse = propertyFor(result, tenants.id, "Rent payments");
    expect(relation.config.related_database_id).toBe(tenants.id);
    expect(relation.config.reciprocal_property_id).toBe(inverse.id);
    expect(inverse.config.related_database_id).toBe(rent.id);
    expect(inverse.config.reciprocal_property_id).toBe(relation.id);
    const rollup = propertyFor(result, rent.id, "Tenant count");
    expect(rollup.config.relation_property_id).toBe(relation.id);
    expect(rollup.config.rollup_property_id).toBe(
      propertyFor(result, tenants.id, "Tenant name").id,
    );
    const tenant = result.records.find(
      (record) => record.database_id === tenants.id,
    )!;
    const copiedRentRecords = result.records.filter(
      (record) => record.database_id === rent.id,
    );
    expect(
      copiedRentRecords.every(
        (record) => record.values[relation.id]?.toString() === tenant.id,
      ),
    ).toBe(true);
    expect(tenant.values[inverse.id]).toEqual(
      copiedRentRecords.map((record) => record.id),
    );
    const paid = result.views.find(
      (view) => view.database_id === rent.id && view.name === "Paid",
    )!;
    expect(paid.filters[0].property_id).toBe(
      propertyFor(result, rent.id, "Status").id,
    );
    expect(paid).toMatchObject({
      property_order: result.properties
        .filter((property) => property.database_id === rent.id)
        .map((property) => property.id)
        .reverse(),
    });
    const board = result.views.find(
      (view) => view.database_id === rent.id && view.type === "board",
    )!;
    expect(board.group_by).toBe(propertyFor(result, rent.id, "Status").id);
    expect(new Set(result.properties.map((property) => property.id)).size).toBe(
      result.properties.length,
    );
  });

  it("preserves external links while preventing invalid inverse links into the original database", () => {
    const state = relationFixture();
    const originalTenant = state.records.find(
      (record) => record.database_id === databaseFor(state, "Tenants").id,
    )!;
    const result = duplicatePageSubtree(state, SEED_IDS.ledger, options());
    const database = result.databases.find(
      (database) => database.page_id === "copied-root",
    )!;
    const relation = propertyFor(result, database.id, "Tenant");
    expect(relation.config.related_database_id).toBe(
      databaseFor(state, "Tenants").id,
    );
    expect(relation.config.reciprocal_property_id).toBeUndefined();
    expect(
      result.records
        .filter((record) => record.database_id === database.id)
        .every(
          (record) =>
            (record.values[relation.id] as string[])[0] === originalTenant.id,
        ),
    ).toBe(true);
    expect(
      result.records.find((record) => record.id === originalTenant.id),
    ).toEqual(originalTenant);
    const rollup = propertyFor(result, database.id, "Tenant count");
    expect(rollup.config.rollup_property_id).toBe(
      propertyFor(state, originalTenant.database_id, "Tenant name").id,
    );
  });

  it("rewrites embedded database views and page nodes while preserving code examples and unknown source", () => {
    const state = createSeedState();
    const ledgerView = state.views.find(
      (view) => view.database_id === SEED_IDS.database,
    )!;
    const embed = encodeDirective({
      kind: "database",
      id: SEED_IDS.database,
      viewId: ledgerView.id,
    });
    const pageEmbed = encodeDirective({
      kind: "page",
      id: SEED_IDS.log,
      title: "Tenant Rent Log",
    });
    const source = `${embed}\n\n${pageEmbed}\n\n\`\`\`md\n${embed}\n\`\`\`\n\n:::unknown\n${SEED_IDS.database}\n:::`;
    state.documents.find(
      (document) => document.page_id === SEED_IDS.hub,
    )!.markdown = source;
    const result = duplicatePageSubtree(state, SEED_IDS.hub, options());
    const document = result.documents.find(
      (document) => document.page_id === "copied-root",
    )!;
    const copiedDatabase = result.databases
      .slice(state.databases.length)
      .find((database) => database.name === "Rent Ledger")!;
    const copiedView = result.views
      .slice(state.views.length)
      .find((view) => view.database_id === copiedDatabase.id)!;
    expect(document.markdown).toContain(
      encodeDirective({
        kind: "database",
        id: copiedDatabase.id,
        viewId: copiedView.id,
      }),
    );
    expect(document.markdown).toContain(
      encodeDirective({
        kind: "page",
        id: result.pages
          .slice(state.pages.length)
          .find((page) => page.title === "Tenant Rent Log")!.id,
        title: "Tenant Rent Log",
      }),
    );
    expect(document.markdown).toContain(`\`\`\`md\n${embed}\n\`\`\``);
    expect(document.markdown).toContain(
      `:::unknown\n${SEED_IDS.database}\n:::`,
    );
  });

  it("copies a record page with its title value and reciprocal relationships intact", () => {
    const state = relationFixture();
    const record = state.records.find(
      (record) => record.database_id === SEED_IDS.database,
    )!;
    const result = duplicatePageSubtree(state, record.page_id, options());
    const copy = result.records.find((item) => item.page_id === "copied-root")!;
    expect(copy.database_id).toBe(record.database_id);
    expect(
      copy.values[propertyFor(state, SEED_IDS.database, "Rent Entry").id],
    ).toBe(
      `${state.pages.find((page) => page.id === record.page_id)!.title} (copy)`,
    );
    const tenant = result.records.find(
      (item) => item.database_id === databaseFor(state, "Tenants").id,
    )!;
    expect(tenant.values["rent-reciprocal"]).toContain(copy.id);
    expect(result.databases).toHaveLength(state.databases.length);
    expect(
      result.documents.find((document) => document.page_id === "copied-root")!
        .markdown,
    ).toContain("Proof of payment");
  });

  it("drops deleted relation targets rather than copying invalid references", () => {
    const state = relationFixture();
    const tenant = state.records.find(
      (record) => record.database_id === databaseFor(state, "Tenants").id,
    )!;
    state.pages.find((page) => page.id === tenant.page_id)!.deleted_at = now;
    const result = duplicatePageSubtree(state, SEED_IDS.ledger, options());
    const database = result.databases.find(
      (database) => database.page_id === "copied-root",
    )!;
    const relation = propertyFor(result, database.id, "Tenant");
    expect(
      result.records
        .filter((record) => record.database_id === database.id)
        .every(
          (record) => (record.values[relation.id] as string[]).length === 0,
        ),
    ).toBe(true);
  });

  it("leaves trash excluded and rejects colliding IDs", () => {
    const state = createSeedState();
    state.pages.find((page) => page.id === SEED_IDS.deposits)!.deleted_at = now;
    const result = duplicatePageSubtree(state, SEED_IDS.hub, options());
    expect(
      result.pages
        .slice(state.pages.length)
        .some((page) => page.title === "Last Month Rent Deposits"),
    ).toBe(false);
    expect(() =>
      duplicatePageSubtree(state, SEED_IDS.hub, { rootId: SEED_IDS.log }),
    ).toThrow("unique ID");
    expect(duplicatePageSubtree(state, "missing")).toBe(state);
  });
});

describe("linked database views", () => {
  it("gives a duplicated page's linked blocks their own copies of their views", () => {
    const state = createSeedState();
    const tenants = state.databases.find((d) => d.page_id === SEED_IDS.tenants)!;
    const host = state.pages.find((p) => p.title === "Getting started")!;
    const block = "block-1";
    const withLink = {
      ...state,
      documents: state.documents.map((d) =>
        d.page_id === host.id ? { ...d, markdown: `Notes\n\n:::slate {"kind":"database","id":"${tenants.id}","block":"${block}"}\n` } : d,
      ),
      views: [
        ...state.views,
        { id: "linked-view", database_id: tenants.id, placement: block, name: "Mine", type: "board" as const, filters: [], sorts: [], hidden_properties: [] },
      ],
    };
    const copied = duplicatePageSubtree(withLink, host.id, { rootId: "copy-root" });
    const markdown = copied.documents.find((d) => d.page_id === "copy-root")!.markdown;
    const newBlock = /"block":"([^"]+)"/.exec(markdown)?.[1];
    expect(newBlock).toBeTruthy();
    expect(newBlock).not.toBe(block);
    const placed = copied.views.filter((v) => v.placement === newBlock);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ name: "Mine", type: "board", database_id: tenants.id });
    // The original block keeps its own view, and the database's own views aren't copied.
    expect(copied.views.filter((v) => v.placement === block)).toHaveLength(1);
    expect(copied.views.filter((v) => v.database_id === tenants.id && !v.placement)).toHaveLength(
      withLink.views.filter((v) => v.database_id === tenants.id && !v.placement).length,
    );
  });
});
