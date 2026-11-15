/**
 * What shows while something loads: the shape of what's coming (a page, the sidebar's
 * pages, an editor's lines) in soft grey blocks, rather than a spinner or "Loading…" text.
 * They fade in after a moment, so a fast load never flashes them, and shimmer gently
 * (standing still for reduced motion). Screen readers hear "Loading…" once.
 */

/** Line widths that read like text (not every line the same length). */
const LINES = ["92%", "86%", "96%", "64%", "88%", "72%"];

function Lines({ count, from = 0 }: { count: number; from?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="skeleton skeleton-line" style={{ width: LINES[(index + from) % LINES.length] }} />
      ))}
    </>
  );
}

/** A page on its way: icon, title, a line under it, then paragraphs. */
export function PageSkeleton({ label = "Loading your page…" }: { label?: string }) {
  return (
    <div className="skeleton-page" role="status" aria-label={label}>
      <span className="skeleton skeleton-icon" aria-hidden />
      <span className="skeleton skeleton-title" aria-hidden />
      <span className="skeleton skeleton-line skeleton-subtitle" aria-hidden />
      <div className="skeleton-block" aria-hidden>
        <Lines count={4} />
      </div>
      <div className="skeleton-block" aria-hidden>
        <span className="skeleton skeleton-heading" />
        <Lines count={3} from={2} />
      </div>
    </div>
  );
}

/** A page's text, while the editor itself loads (the title is already there). */
export function EditorSkeleton() {
  return (
    <div className="skeleton-editor" role="status" aria-label="Loading the editor…">
      <div className="skeleton-block" aria-hidden>
        <Lines count={4} />
      </div>
      <div className="skeleton-block" aria-hidden>
        <Lines count={2} from={3} />
      </div>
    </div>
  );
}

/** The sidebar's pages: rows with an icon and a name. */
export function SidebarSkeleton() {
  const widths = ["70%", "55%", "80%", "62%", "48%", "74%"];
  return (
    <div className="skeleton-sidebar" aria-hidden>
      {widths.map((width, index) => (
        <span key={index} className="skeleton-row" style={{ paddingLeft: index === 2 || index === 3 ? 18 : 0 }}>
          <span className="skeleton skeleton-row-icon" />
          <span className="skeleton skeleton-row-name" style={{ width }} />
        </span>
      ))}
    </div>
  );
}
