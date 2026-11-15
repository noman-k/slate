import { describe, expect, it } from "vitest";
import { createSeedState, SEED_IDS } from "./fixtures/seed";
import { planWorkspaceMove } from "../src/lib/workspace-move";

describe("moving to another workspace", () => {
  it("takes everything inside, and keeps relations that move together", () => {
    const state = createSeedState();
    const plan = planWorkspaceMove(state, SEED_IDS.hub);
    // The hub holds the log, the ledger and the other databases, with their rows.
    expect(plan.pageIds).toContain(SEED_IDS.ledger);
    expect(plan.pageIds).toContain(SEED_IDS.tenants);
    expect(plan.databases.map((d) => d.name)).toEqual(expect.arrayContaining(["Rent Ledger", "Tenants"]));
    expect(plan.rows).toBeGreaterThan(0);
    // The ledger's Tenant relation moves along with Tenants: nothing breaks.
    expect(plan.brokenRelations).toEqual([]);
    expect(plan.isRow).toBe(false);
  });

  it("says which relations would be unlinked when only one side moves", () => {
    const state = createSeedState();
    const ledger = planWorkspaceMove(state, SEED_IDS.ledger);
    expect(ledger.brokenRelations.map((b) => [b.property.name, b.database, b.linksTo])).toEqual([
      ["Tenant", "Rent Ledger", "Tenants"],
    ]);
    // The same relation, seen from the database it links to.
    expect(planWorkspaceMove(state, SEED_IDS.tenants).brokenRelations.map((b) => b.property.name)).toEqual(["Tenant"]);
  });

  it("knows a row moves with its database, not on its own", () => {
    const state = createSeedState();
    const row = state.records[0];
    expect(planWorkspaceMove(state, row.page_id).isRow).toBe(true);
  });
});
