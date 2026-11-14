"use client";
import { createContext, type ReactNode } from "react";
import type { Page } from "../../lib/types";

export interface EmbedOptions {
  /** `block` is set for a linked database: that block has its own views. */
  renderDatabase?: (id: string, block?: string) => ReactNode;
  onOpenPage?: (id: string) => void;
  /** Live title, icon and kind of a linked page (the stored title can be stale). */
  resolvePage?: (id: string) => Pick<Page, "title" | "icon" | "kind"> | undefined;
  /** Databases a "record" parameter can pick from. */
  listDatabases?: () => { id: string; name: string }[];
}
export const EmbedContext = createContext<EmbedOptions>({});
