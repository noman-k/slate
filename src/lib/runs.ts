/**
 * Run history: every run of a playbook is a record in a "Runs" database that lives
 * inside the playbook. Its properties are the run's status, times, result and inputs;
 * its page is a readable log. The step-by-step progress is kept in a system property
 * (hidden from every view) so a run can be paused and picked up again.
 */
import { cellValue, recordTitle } from "./database";
import {
  displayValue,
  interpolate,
  shownValue,
  runLogMarkdown,
  type Lookup,
  type Procedure,
  type RunState,
} from "./runner";
import type { DbRecord, Page, Property, WorkspaceState } from "./types";
import { id } from "./utils";

export const RUN_STATUS = { running: "Running", done: "Done", stopped: "Stopped" } as const;
const SYSTEM_STATE = "run-state";

/** The playbook's Runs database, if it has one. */
export function runsDatabaseOf(state: WorkspaceState, pageId: string) {
  return state.databases.find((db) => {
    const page = state.pages.find((p) => p.id === db.page_id);
    return (
      page?.parent_id === pageId &&
      !page.deleted_at &&
      state.properties.some((p) => p.database_id === db.id && p.config.system === SYSTEM_STATE)
    );
  });
}

const propertyOf = (state: WorkspaceState, databaseId: string, test: (p: Property) => boolean) =>
  state.properties.find((p) => p.database_id === databaseId && test(p));

/** A record parameter reads as the record's title, or one of its properties. */
export function recordLookup(state: WorkspaceState): Lookup {
  return (_param, value, property) => {
    const record = state.records.find((r) => r.id === value);
    if (!record) return value;
    if (!property) return recordTitle(record, state);
    const prop = propertyOf(state, record.database_id, (p) => p.name.toLowerCase() === property.toLowerCase());
    const cell = prop ? cellValue(record, prop, state) : null;
    return Array.isArray(cell) ? cell.join(", ") : cell === null || cell === undefined ? "" : String(cell);
  };
}

/** Creates the Runs database on first use, and adds a column for any new parameter. */
export function ensureRunsDatabase(
  state: WorkspaceState,
  playbook: Page,
  procedure: Procedure,
): { state: WorkspaceState; databaseId: string } {
  const now = new Date().toISOString();
  let next = state;
  let database = runsDatabaseOf(state, playbook.id);
  if (!database) {
    const databaseId = id(),
      pageId = id();
    const prop = (
      name: string,
      type: Property["type"],
      position: number,
      width: number,
      config: Property["config"] = {},
    ): Property => ({
      id: id(),
      database_id: databaseId,
      name,
      type,
      position,
      width,
      config,
    });
    const status = prop("Status", "status", 1, 140, { options: Object.values(RUN_STATUS) });
    const started = prop("Started", "datetime", 2, 200);
    database = { id: databaseId, workspace_id: playbook.workspace_id, page_id: pageId, name: "Runs" };
    next = {
      ...next,
      pages: [
        ...next.pages,
        {
          id: pageId,
          workspace_id: playbook.workspace_id,
          parent_id: playbook.id,
          title: "Runs",
          icon: "icon:activity:gray",
          kind: "database",
          database_id: databaseId,
          description: `Every run of ${playbook.title || "this page"}, newest first.`,
          position: next.pages.filter((p) => p.parent_id === playbook.id).length,
          favorite: false,
          deleted_at: null,
          created_at: now,
          updated_at: now,
        },
      ],
      documents: [...next.documents, { page_id: pageId, markdown: "", updated_at: now }],
      databases: [...next.databases, database],
      properties: [
        ...next.properties,
        prop("Run", "title", 0, 280),
        status,
        started,
        prop("Finished", "datetime", 3, 200),
        prop("Result", "text", 4, 260),
        prop("Progress", "text", 99, 120, { system: SYSTEM_STATE }),
      ],
      views: [
        ...next.views,
        {
          id: id(),
          database_id: databaseId,
          name: "All runs",
          type: "table",
          filters: [],
          sorts: [{ property_id: started.id, direction: "desc" }],
          hidden_properties: [],
        },
        {
          id: id(),
          database_id: databaseId,
          name: "By status",
          type: "board",
          filters: [],
          sorts: [{ property_id: started.id, direction: "desc" }],
          hidden_properties: [],
          group_by: status.id,
        },
      ],
    };
  }
  const databaseId = database.id;
  // One column per parameter, so runs can be sorted and filtered by their inputs.
  const missing = procedure.params.filter(
    (param) => !propertyOf(next, databaseId, (p) => p.config.param === param.name),
  );
  if (missing.length) {
    const top = Math.max(
      0,
      ...next.properties.filter((p) => p.database_id === databaseId && !p.config.system).map((p) => p.position),
    );
    next = {
      ...next,
      properties: [
        ...next.properties,
        ...missing.map((param, index) => ({
          id: id(),
          database_id: databaseId,
          name: param.name.replace(/_/g, " "),
          type: (param.type === "number" ? "number" : param.type === "date" ? "date" : "text") as Property["type"],
          position: top + 1 + index,
          width: 180,
          config: { param: param.name },
        })),
      ],
    };
  }
  return { state: next, databaseId };
}

function runTitle(procedure: Procedure, run: RunState, lookup: Lookup, started: Date) {
  const first = procedure.params[0];
  const label = first && first.type !== "secret" ? displayValue(procedure, run.vars, first.name, lookup) : "";
  const when = started.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return label ? `${label} · ${when}` : `Run · ${when}`;
}

/** What the Result column says: where the run ended up. */
export function runResult(procedure: Procedure, run: RunState, lookup?: Lookup) {
  if (run.status === "stopped") return "Stopped";
  if (run.status === "running") {
    const step = procedure.steps[run.step];
    return step ? `At step ${run.step + 1} of ${procedure.steps.length}` : "Running";
  }
  const last = run.log[run.log.length - 1];
  const step = last ? procedure.steps[last.step] : undefined;
  if (step?.step === "end" && step.text) return interpolate(step.text, procedure, run.vars, lookup);
  const failed = run.log.filter((entry) => entry.result === "Failed").length;
  return failed ? `Finished with ${failed} failed ${failed === 1 ? "check" : "checks"}` : "Finished";
}

/** Writes a run's progress, status and log to its record. */
export function saveRun(state: WorkspaceState, recordId: string, procedure: Procedure, run: RunState): WorkspaceState {
  const record = state.records.find((r) => r.id === recordId);
  if (!record) return state;
  const lookup = recordLookup(state);
  const now = new Date().toISOString();
  const db = record.database_id;
  const values = { ...record.values };
  const put = (test: (p: Property) => boolean, value: DbRecord["values"][string]) => {
    const property = propertyOf(state, db, test);
    if (property) values[property.id] = value;
  };
  put((p) => p.type === "status", RUN_STATUS[run.status]);
  put((p) => p.name === "Finished" && p.type === "datetime", run.status === "running" ? null : now);
  put((p) => p.name === "Result" && p.type === "text", runResult(procedure, run, lookup));
  put((p) => p.config.system === SYSTEM_STATE, JSON.stringify(run));
  const log = runLogMarkdown(procedure, run, lookup);
  return {
    ...state,
    records: state.records.map((r) => (r.id === recordId ? { ...r, values, updated_at: now } : r)),
    documents: state.documents.some((d) => d.page_id === record.page_id)
      ? state.documents.map((d) => (d.page_id === record.page_id ? { ...d, markdown: log, updated_at: now } : d))
      : [...state.documents, { page_id: record.page_id, markdown: log, updated_at: now }],
  };
}

/** Starts a run: a new record in the Runs database (created if needed). */
export function createRun(
  state: WorkspaceState,
  playbook: Page,
  procedure: Procedure,
  run: RunState,
): { state: WorkspaceState; recordId: string } {
  const made = ensureRunsDatabase(state, playbook, procedure);
  let next = made.state;
  const lookup = recordLookup(next);
  const started = new Date();
  const recordId = id(),
    pageId = id(),
    now = started.toISOString();
  const db = made.databaseId;
  const title = runTitle(procedure, run, lookup, started);
  const values: DbRecord["values"] = {};
  for (const property of next.properties.filter((p) => p.database_id === db)) {
    if (property.type === "title") values[property.id] = title;
    if (property.name === "Started" && property.type === "datetime") values[property.id] = now;
    const param = procedure.params.find((p) => p.name === property.config.param);
    if (param) {
      // Secrets are never written to run history.
      const shown = shownValue(procedure, run.vars, param.name, lookup);
      values[property.id] = property.type === "number" && shown !== "" ? Number(shown) : shown || null;
    }
  }
  const position = Math.max(0, ...next.records.filter((r) => r.database_id === db).map((r) => r.position)) + 1;
  next = {
    ...next,
    records: [
      ...next.records,
      { id: recordId, database_id: db, page_id: pageId, values, position, created_at: now, updated_at: now },
    ],
    pages: [
      ...next.pages,
      {
        id: pageId,
        workspace_id: playbook.workspace_id,
        parent_id: next.databases.find((d) => d.id === db)!.page_id,
        title,
        icon: "",
        kind: "document",
        description: "",
        position,
        favorite: false,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      },
    ],
  };
  return { state: saveRun(next, recordId, procedure, run), recordId };
}

/** A run's saved progress, if the record is a run. */
export function readRun(state: WorkspaceState, record: DbRecord): RunState | null {
  const property = propertyOf(state, record.database_id, (p) => p.config.system === SYSTEM_STATE);
  const raw = property ? record.values[property.id] : null;
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as RunState;
  } catch {
    return null;
  }
}

/** The playbook's runs, newest first, with their saved progress. */
export function runsOf(state: WorkspaceState, pageId: string) {
  const database = runsDatabaseOf(state, pageId);
  if (!database) return { database: undefined, runs: [] as { record: DbRecord; run: RunState }[] };
  const runs = state.records
    .filter((r) => r.database_id === database.id && !state.pages.find((p) => p.id === r.page_id)?.deleted_at)
    .map((record) => ({ record, run: readRun(state, record) }))
    .filter((item): item is { record: DbRecord; run: RunState } => !!item.run)
    .sort((a, b) => b.record.created_at.localeCompare(a.record.created_at));
  return { database, runs };
}
