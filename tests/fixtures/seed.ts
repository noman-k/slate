import type {
  WorkspaceState,
  Page,
  Property,
  DbRecord,
  DatabaseView,
} from "../../src/lib/types";
const stamp = "2026-11-11T22:00:00.000Z";
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const SEED_IDS = {
  workspace: uid(1),
  hub: uid(2),
  log: uid(3),
  ledger: uid(4),
  database: uid(5),
  tenants: uid(6),
  units: uid(7),
  deposits: uid(8),
  guide: uid(9),
};
const page = (
  n: number,
  title: string,
  parent: number | null,
  position: number,
  kind: "document" | "database" = "document",
  icon = "",
): Page => ({
  id: uid(n),
  workspace_id: uid(1),
  parent_id: parent ? uid(parent) : null,
  title,
  icon,
  kind,
  description: "",
  position,
  favorite: false,
  deleted_at: null,
  created_at: stamp,
  updated_at: stamp,
});
export function createSeedState(): WorkspaceState {
  const pages = [
    page(2, "Rental Property Finance Hub", null, 0, "document", "icon:house:orange"),
    page(3, "Tenant Rent Log", 2, 0, "document", "icon:receipt:green"),
    page(4, "Rent Ledger", 3, 0, "database"),
    page(6, "Tenants", 2, 1, "database"),
    page(7, "Properties & Units", 2, 2, "database"),
    page(8, "Last Month Rent Deposits", 2, 3, "database"),
    page(9, "Getting started", null, 1, "document"),
    page(10, "Workspace notes", null, 2, "document"),
  ];
  pages.find((p) => p.id === uid(4))!.description =
    "Private rent collection register — one record per tenant/unit/rent month. Financial amounts are in CAD. Track amounts due and collected, overdue balances, proof of payment, and annual reconciliations.";
  for (const p of pages.filter((p) => p.kind === "database"))
    p.database_id =
      p.id === uid(4) ? uid(5) : uid(100 + Number(p.id.slice(-3)));
  const properties: Property[] = [
    {
      id: uid(20),
      database_id: uid(5),
      name: "Rent Entry",
      type: "title",
      position: 0,
      width: 305,
      config: {},
    },
    {
      id: uid(21),
      database_id: uid(5),
      name: "Amount Received",
      type: "currency",
      position: 1,
      width: 210,
      config: {},
    },
    {
      id: uid(22),
      database_id: uid(5),
      name: "Created",
      type: "created_time",
      position: 2,
      width: 250,
      config: {},
    },
    {
      id: uid(23),
      database_id: uid(5),
      name: "Credit Brought Forward",
      type: "currency",
      position: 3,
      width: 220,
      config: {},
    },
    {
      id: uid(24),
      database_id: uid(5),
      name: "Status",
      type: "status",
      position: 4,
      width: 140,
      config: { options: ["Paid", "Pending", "Overdue"] },
    },
    {
      id: uid(25),
      database_id: uid(5),
      name: "Amount Due",
      type: "currency",
      position: 5,
      width: 180,
      config: {},
    },
    {
      id: uid(26),
      database_id: uid(5),
      name: "Tenant",
      type: "relation",
      position: 6,
      width: 190,
      config: { related_database_id: uid(106) },
    },
    {
      id: uid(27),
      database_id: uid(5),
      name: "Balance",
      type: "formula",
      position: 7,
      width: 160,
      config: {
        expression:
          'prop("Amount Due") - prop("Amount Received") - prop("Credit Brought Forward")',
      },
    },
  ];
  const entries = [
    { month: "04", amount: 1300, time: "17:57" },
    { month: "03", amount: 2600, time: "17:35", extra: " — First Month" },
    { month: "05", amount: 1300, time: "18:00" },
    { month: "11", amount: 1300, time: "18:10" },
    { month: "10", amount: 1100, time: "18:09", credit: 200 },
    { month: "09", amount: 1500, time: "18:07" },
    { month: "08", amount: 1300, time: "18:06" },
    { month: "07", amount: 1300, time: "18:04" },
    { month: "06", amount: 1300, time: "18:02" },
  ];
  const records: DbRecord[] = entries.map((e, i) => {
    const p = page(40 + i, `2026-${e.month} — Basement${e.extra || ""}`, 4, i);
    pages.push(p);
    return {
      id: uid(60 + i),
      database_id: uid(5),
      page_id: p.id,
      position: i,
      created_at: `2026-11-11T${e.time}:00`,
      updated_at: stamp,
      values: {
        [uid(20)]: p.title,
        [uid(21)]: e.amount,
        [uid(23)]: e.credit || null,
        [uid(24)]: "Paid",
        [uid(25)]: e.month === "03" ? 2600 : 1300,
        [uid(26)]: [uid(90)],
      },
    };
  });
  const views: DatabaseView[] = [
    {
      id: uid(30),
      database_id: uid(5),
      name: "Default view",
      type: "table",
      filters: [],
      sorts: [],
      hidden_properties: [],
    },
    {
      id: uid(31),
      database_id: uid(5),
      name: "All Rent",
      type: "table",
      filters: [],
      sorts: [{ property_id: uid(20), direction: "asc" }],
      hidden_properties: [],
    },
    {
      id: uid(32),
      database_id: uid(5),
      name: "Follow Up",
      type: "table",
      filters: [
        { property_id: uid(24), operator: "not_equals", value: "Paid" },
      ],
      sorts: [],
      hidden_properties: [],
    },
    {
      id: uid(33),
      database_id: uid(5),
      name: "Paid",
      type: "table",
      filters: [{ property_id: uid(24), operator: "equals", value: "Paid" }],
      sorts: [],
      hidden_properties: [],
    },
    {
      id: uid(34),
      database_id: uid(5),
      name: "By status",
      type: "board",
      filters: [],
      sorts: [],
      hidden_properties: [],
      group_by: uid(24),
    },
    {
      id: uid(35),
      database_id: uid(5),
      name: "Rent list",
      type: "list",
      filters: [],
      sorts: [],
      hidden_properties: [],
    },
  ];
  for (const p of pages.filter(
    (p) => p.kind === "database" && p.id !== uid(4),
  )) {
    properties.push(
      {
        id: uid(200 + Number(p.id.slice(-3))),
        database_id: p.database_id!,
        name:
          p.id === uid(6)
            ? "Tenant name"
            : p.id === uid(7)
              ? "Property name"
              : "Deposit",
        type: "title",
        position: 0,
        width: 320,
        config: {},
      },
      {
        id: uid(300 + Number(p.id.slice(-3))),
        database_id: p.database_id!,
        name: p.id === uid(6) ? "Email" : "Notes",
        type: p.id === uid(6) ? "email" : "text",
        position: 1,
        width: 260,
        config: {},
      },
    );
    views.push({
      id: uid(400 + Number(p.id.slice(-3))),
      database_id: p.database_id!,
      name: "Default view",
      type: "table",
      filters: [],
      sorts: [],
      hidden_properties: [],
    });
  }
  const tenant = page(89, "Alex Morgan", 6, 0);
  pages.push(tenant);
  records.push({
    id: uid(90),
    database_id: uid(106),
    page_id: tenant.id,
    position: 0,
    created_at: stamp,
    updated_at: stamp,
    values: { [uid(206)]: "Alex Morgan", [uid(306)]: "alex@example.com" },
  });
  const unit = page(91, "Basement · 24 Maple Avenue", 7, 0);
  pages.push(unit);
  records.push({
    id: uid(92),
    database_id: uid(107),
    page_id: unit.id,
    position: 0,
    created_at: stamp,
    updated_at: stamp,
    values: { [uid(207)]: unit.title, [uid(307)]: "1 bedroom · Residential" },
  });
  return {
    workspaces: [{ id: uid(1), name: "Noman’s Space 02" }],
    pages,
    documents: [
      {
        page_id: uid(2),
        markdown:
          "# A home for your property finances\n\nKeep the details in one place, and make room for the bigger picture.\n\n## Your workspace\n\n- **Tenant Rent Log** — monthly rent, payments, and follow-ups\n- **Tenants** — the people who call your properties home\n- **Properties & Units** — a little context for every address\n- **Last Month Rent Deposits** — security deposits, kept organized\n\n> A clear record today makes tomorrow a little easier.\n",
        updated_at: stamp,
      },
      {
        page_id: uid(3),
        markdown:
          "Keep every payment in view. Open **Rent Ledger** in the sidebar to manage your rent collection register.\n\n## Monthly checklist\n\n- [x] Reconcile incoming payments\n- [x] Update tenant records\n- [ ] Review outstanding balances\n- [ ] File payment receipts\n",
        updated_at: stamp,
      },
      {
        page_id: uid(9),
        markdown:
          "# Make yourself at home\n\nSlate is a quiet place for your notes, ideas, and everything in between.\n\n## Start with a page\n\nClick **New page** in the sidebar. Give it a name, then start writing.\n\n- Type `/` to insert a block\n- Type `## ` for a heading\n- Use **⌘ K** to find anything\n- Switch to **Markdown** to edit the source\n\n## Bring a little structure\n\nCreate a database to organize your work. Every record is a page, and every view is a different perspective on the same information.\n\n> Everything in this workspace is private to you.\n",
        updated_at: stamp,
      },
      {
        page_id: uid(10),
        markdown:
          "## A fresh start\n\nA place for the things you don’t want to forget.\n\n- [ ] Add your first idea\n",
        updated_at: stamp,
      },
    ],
    databases: pages
      .filter((p) => p.kind === "database")
      .map((p) => ({
        id: p.database_id!,
        workspace_id: uid(1),
        page_id: p.id,
        name: p.title,
      })),
    properties,
    records,
    views,
    active_workspace_id: uid(1),
  };
}
