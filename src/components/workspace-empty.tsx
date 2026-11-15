"use client";
/** What the page area shows when there's no page to show. */
import { FileText, Table2 } from "lucide-react";
import type { Page } from "@/lib/types";

/** The address is for a page that's in the Trash, or that isn't here at all. */
export function MissingPage({
  page,
  onRestore,
  onHome,
}: {
  page: Page | undefined;
  onRestore: (pageId: string) => void;
  onHome: () => void;
}) {
  return (
    <div className="empty-workspace" role="status">
      <FileText size={36} />
      {page?.deleted_at ? (
        <>
          <h2>“{page.title || "Untitled"}” is in the Trash.</h2>
          <p>Restore it to open it again, or go back to your pages.</p>
        </>
      ) : (
        <>
          <h2>This page isn’t here.</h2>
          <p>It may have been deleted, or the link is for another account.</p>
        </>
      )}
      <div className="empty-workspace-actions">
        {page?.deleted_at && (
          <button className="primary-button" onClick={() => onRestore(page.id)}>
            Restore
          </button>
        )}
        <button className={page?.deleted_at ? "secondary-button" : "primary-button"} onClick={onHome}>
          Go to your pages
        </button>
      </div>
    </div>
  );
}

/** A workspace with no pages yet. */
export function EmptyWorkspace({ onNew }: { onNew: (kind: "document" | "database") => void }) {
  return (
    <div className="empty-workspace">
      <FileText size={36} />
      <h2>A little room to think.</h2>
      <p>Start with a page to write in, or a database to organize.</p>
      <div className="empty-workspace-actions">
        <button className="primary-button" onClick={() => onNew("document")}>
          <FileText size={16} />
          New page
        </button>
        <button className="secondary-button" onClick={() => onNew("database")}>
          <Table2 size={16} />
          New database
        </button>
      </div>
    </div>
  );
}
