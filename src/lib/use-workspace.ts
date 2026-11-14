"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceState, SaveStatus } from "./types";
import { normalizePageIcon } from "@/components/page-icon";
import {
  isSupabaseConfigured,
  loadRemoteState,
  saveRemoteState,
  getRemoteIdentity,
} from "./persistence";
const emptyState = (): WorkspaceState => ({
  workspaces: [],
  pages: [],
  documents: [],
  databases: [],
  properties: [],
  records: [],
  views: [],
  active_workspace_id: "",
});
function validState(value: unknown): value is WorkspaceState {
  return (
    !!value &&
    typeof value === "object" &&
    [
      "pages",
      "documents",
      "databases",
      "properties",
      "records",
      "views",
      "workspaces",
    ].every((key) => Array.isArray((value as Record<string, unknown>)[key]))
  );
}
export function useWorkspace() {
  const [state, setState] = useState<WorkspaceState>(emptyState);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<WorkspaceState | null>(null);
  const current = useRef(state);
  const persisted = useRef<WorkspaceState | undefined>(undefined);
  const loaded = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const journalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const queued = useRef(false);
  const dirty = useRef(false);
  const owner = useRef<string | null>(null);
  const baseRevision = useRef<number | null>(null);
  const hydration = useRef<Promise<boolean> | null>(null);
  const journal = useCallback(() => {
    if (!loaded.current) return;
    try {
      if (owner.current && dirty.current)
        localStorage.setItem(
          `slate-pending:${owner.current}`,
          JSON.stringify({
            base_revision: baseRevision.current,
            state: current.current,
          }),
        );
    } catch {
      setError(
        "Device storage is full. Keep this tab open until your changes finish syncing.",
      );
    }
  }, []);
  const hydrate = useCallback(() => {
    if (hydration.current) return hydration.current;
    const task = (async () => {
      try {
        let next: WorkspaceState | null = null;
        let replay = false;
        if (!isSupabaseConfigured)
          throw new Error(
            "Slate isn't connected to Supabase. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
          );
        next = await loadRemoteState();
        persisted.current = next || undefined;
        const identity = getRemoteIdentity();
        owner.current = identity.userId;
        baseRevision.current = identity.revision;
        const raw = identity.userId
          ? localStorage.getItem(`slate-pending:${identity.userId}`)
          : null;
        if (raw) {
          const draft = JSON.parse(raw) as {
            base_revision: number;
            state: unknown;
          };
          if (validState(draft.state)) {
            if (draft.base_revision === identity.revision) {
              next = draft.state;
              replay = true;
              dirty.current = true;
            } else {
              setRecovery(draft.state);
              setError(
                "An unsynced draft from an earlier version is available. Download it to preserve those edits.",
              );
            }
          }
        }
        if (next) {
          // Page icons are line icons only: convert emoji (and the old "file" marker).
          if (next.pages.some((page) => normalizePageIcon(page.icon) !== page.icon))
            next = {
              ...next,
              pages: next.pages.map((page) => {
                const icon = normalizePageIcon(page.icon);
                return icon === page.icon ? page : { ...page, icon };
              }),
            };
          current.current = next;
          setState(next);
        }
        loaded.current = true;
        setStatus(replay ? "saving" : "saved");
        return replay;
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Unable to load your workspace.",
        );
        setStatus("error");
        return false;
      } finally {
        setReady(true);
      }
    })();
    hydration.current = task;
    void task.finally(() => {
      hydration.current = null;
    });
    return task;
  }, []);
  const save = useCallback(async () => {
    if (!loaded.current) return;
    if (saving.current) {
      queued.current = true;
      return;
    }
    saving.current = true;
    setStatus("saving");
    try {
      do {
        queued.current = false;
        const snapshot = current.current;
        await saveRemoteState(snapshot, persisted.current, owner.current);
        const savedIdentity = getRemoteIdentity();
        if (savedIdentity.userId === owner.current)
          baseRevision.current = savedIdentity.revision;
        persisted.current = snapshot;
        if (snapshot === current.current) {
          dirty.current = false;
          if (owner.current)
            localStorage.removeItem(`slate-pending:${owner.current}`);
        } else journal();
      } while (queued.current);
      setStatus("saved");
      setError((previous) =>
        previous.startsWith("An unsynced draft") ? previous : "",
      );
    } catch (e) {
      journal();
      setStatus("error");
      setError(
        e instanceof Error
          ? e.message
          : "Your changes could not be saved. Retry to keep them safe.",
      );
    } finally {
      saving.current = false;
    }
  }, [journal]);
  useEffect(() => {
    queueMicrotask(async () => {
      if (await hydrate()) void save();
    });
  }, [hydrate, save]);
  const change = useCallback(
    (updater: (s: WorkspaceState) => WorkspaceState) => {
      if (!loaded.current) return;
      const next = updater(current.current);
      current.current = next;
      dirty.current = true;
      if (saving.current) queued.current = true;
      setState(next);
      setStatus("saving");
      if (pending.current) clearTimeout(pending.current);
      if (journalTimer.current) clearTimeout(journalTimer.current);
      journalTimer.current = setTimeout(journal, 120);
      pending.current = setTimeout(() => void save(), 700);
    },
    [save, journal],
  );
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      journal();
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") {
        journal();
        if (dirty.current) void save();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      journal();
      if (pending.current) clearTimeout(pending.current);
      if (journalTimer.current) clearTimeout(journalTimer.current);
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [save, journal]);
  const retry = useCallback(async () => {
    if (loaded.current) await save();
    else if (await hydrate()) await save();
  }, [save, hydrate]);
  return {
    state,
    change,
    ready,
    status,
    error,
    recovery,
    retry,
  };
}
