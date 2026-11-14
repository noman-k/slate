import type { WorkspaceState } from "./types";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase/client";
export { isSupabaseConfigured };

let revision: number | null = null;
let userId: string | null = null;

/** The server returns a consistent snapshot assembled from normalized, RLS-scoped tables. */
export async function loadRemoteState(): Promise<WorkspaceState | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = getSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user)
    throw new Error(
      "Your session has expired. Sign in again to access your workspace.",
    );
  userId = user.id;
  const { data, error } = await supabase.rpc("load_workspace_state");
  if (error) throw new Error(`Unable to load your workspace: ${error.message}`);
  revision = Number(data.revision);
  const state = data.state as WorkspaceState;
  if (!state.active_workspace_id)
    state.active_workspace_id = state.workspaces[0]?.id ?? "";
  return state;
}

/** The workspace was saved elsewhere since this tab loaded it (see mergeStates). */
export class SyncConflictError extends Error {}

/** Saves all related mutations in one transaction and rejects a stale tab's changes. */
export async function saveRemoteState(
  state: WorkspaceState,
  _previous?: WorkspaceState,
  expectedUserId?: string | null,
): Promise<void> {
  if (!isSupabaseConfigured) return;
  if (revision === null || !userId)
    throw new Error("Load your private workspace before saving.");
  if (expectedUserId && expectedUserId !== userId)
    throw new Error(
      "The signed-in account changed. Your draft remains saved for its owner.",
    );
  const savingUserId = userId;
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== savingUserId)
    throw new Error("Sign in to the original account to sync this draft.");
  const { data, error } = await supabase.rpc("save_workspace_state", {
    p_state: state,
    p_expected_revision: revision,
  });
  if (error) {
    if (error.message.includes("conflict"))
      throw new SyncConflictError(
        "This workspace changed in another tab. Your local edits are retained; reload before making further changes.",
      );
    throw new Error(`Your changes could not be synced: ${error.message}`);
  }
  if (userId === savingUserId) revision = Number(data);
}

/**
 * The account's current revision, without loading the workspace: a cheap way for an idle tab
 * to notice changes made elsewhere (another tab, or an AI agent creating pages).
 */
export async function loadRemoteRevision(): Promise<number | null> {
  if (!isSupabaseConfigured || !userId) return null;
  const { data, error } = await getSupabaseClient().from("profiles").select("sync_revision").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  return Number(data.sync_revision);
}

export function getRemoteIdentity(): {
  userId: string | null;
  revision: number | null;
} {
  return { userId, revision };
}
