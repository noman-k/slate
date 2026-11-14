"use client";
/**
 * Playbooks: one place to see and run every playbook in the workspace, without moving
 * them out of the pages they belong to. Each row shows when to use it, where it lives,
 * its last run, and any run still in progress.
 */
import { Compass, Play, Plus, RotateCcw } from "lucide-react";
import { PageIcon } from "./page-icon";
import { parseProcedure } from "@/lib/runner";
import { runsOf } from "@/lib/runs";
import { recordTitle } from "@/lib/database";
import { breadcrumbs } from "@/lib/tree";
import type { Page, WorkspaceState } from "@/lib/types";

/** A real playbook: a document (not a database record) with steps or inputs. */
export function isPlaybookPage(state: WorkspaceState, page: Page) {
  if (page.kind !== "document" || page.deleted_at) return false;
  if (state.records.some((r) => r.page_id === page.id)) return false;
  const procedure = parseProcedure(state.documents.find((d) => d.page_id === page.id)?.markdown || "");
  return procedure.steps.length > 0 || procedure.params.length > 0;
}

export function playbookPages(state: WorkspaceState) {
  return state.pages.filter((page) => isPlaybookPage(state, page));
}

export const PLAYBOOKS_VIEW = "playbooks";

export function PlaybooksView({
  state,
  timeAgo,
  onOpen,
  onRun,
  onResume,
  onNew,
}: {
  state: WorkspaceState;
  timeAgo: (iso: string) => string;
  onOpen: (pageId: string) => void;
  onRun: (pageId: string) => void;
  onResume: (pageId: string, recordId: string) => void;
  onNew: () => void;
}) {
  const rows = playbookPages(state)
    .map((page) => {
      const procedure = parseProcedure(state.documents.find((d) => d.page_id === page.id)?.markdown || "");
      const { runs } = runsOf(state, page.id);
      return {
        page,
        steps: procedure.steps.length,
        when: (() => {
          const text = page.description.replace(/^When to use:\s*/i, "");
          return text.charAt(0).toUpperCase() + text.slice(1);
        })(),
        where: breadcrumbs(state.pages, page.id)
          .slice(0, -1)
          .map((p) => p.title || "Untitled")
          .join(" / "),
        runs,
        running: runs.find((r) => r.run.status === "running"),
        last: runs[0]?.record.created_at,
      };
    })
    // Most recently run first; never-run ones after, by name.
    .sort((a, b) => (b.last || "").localeCompare(a.last || "") || (a.page.title || "").localeCompare(b.page.title || ""));
  return (
    <div className="playbooks-view">
      <header className="playbooks-head">
        <div>
          <h1>Playbooks</h1>
          <p>Checklists and guides you can run. They stay in the pages they belong to — this is where to find and run them all.</p>
        </div>
        <button className="primary-button" onClick={onNew}>
          <Plus size={15} />
          New playbook
        </button>
      </header>
      {rows.length === 0 ? (
        <div className="playbooks-empty">
          <Compass size={32} />
          <h2>No playbooks yet</h2>
          <p>Start from a checklist or one of the templates — rent checks, move-ins, incident response and more.</p>
          <button className="primary-button" onClick={onNew}>
            <Plus size={15} />
            New playbook
          </button>
        </div>
      ) : (
        <ul className="playbooks-list" aria-label="Playbooks">
          {rows.map((row) => (
            <li key={row.page.id} className="playbook-row">
              <button className="playbook-main" onClick={() => onOpen(row.page.id)} title={`Open ${row.page.title || "Untitled"}`}>
                <PageIcon page={row.page} size={22} />
                <span className="playbook-text">
                  <strong>{row.page.title || "Untitled"}</strong>
                  {row.when && <span className="playbook-when">{row.when}</span>}
                  <small>
                    {row.where ? `In ${row.where} · ` : ""}
                    {row.steps} {row.steps === 1 ? "step" : "steps"} ·{" "}
                    {row.runs.length
                      ? `${row.runs.length} ${row.runs.length === 1 ? "run" : "runs"}, last ${timeAgo(row.last!)}`
                      : "never run"}
                  </small>
                </span>
              </button>
              <span className="playbook-actions">
                {row.running && (
                  <button
                    className="run-bar-link is-resume"
                    onClick={() => onResume(row.page.id, row.running!.record.id)}
                    title={`Resume ${recordTitle(row.running.record, state)}`}
                  >
                    <RotateCcw size={13} />
                    Resume
                  </button>
                )}
                <button className="run-button" onClick={() => onRun(row.page.id)} aria-label={`Run ${row.page.title || "Untitled"}`}>
                  <Play size={13} />
                  Run
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
