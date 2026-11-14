/**
 * What an AI agent may do, in the words used everywhere it's chosen or shown (Settings ›
 * AI agents, the page that connects an app, the setup guide).
 */
export type AgentScope = "read" | "write" | "edit";

export const AGENT_SCOPES: { value: AgentScope; label: string; hint: string }[] = [
  { value: "read", label: "Read only", hint: "Search and read pages, databases and playbooks." },
  { value: "write", label: "Read and create", hint: "Also add new pages, databases and playbooks. Never changes what’s there." },
  {
    value: "edit",
    label: "Read, create and edit",
    hint: "Also change pages, databases and playbooks, and move them to the Trash (they can be restored).",
  },
];

export const scopeLabel = (scope: string | undefined) =>
  AGENT_SCOPES.find((s) => s.value === scope)?.label ?? "Read only";
