/** Markdown is the canonical document. Application embeds use one-line JSON directives. */
export type WorkspaceDirective = {
  kind: "database" | "page";
  id: string;
  title?: string;
  viewId?: string;
  /** A linked database block's own id: its views belong to this placement. */
  block?: string;
};
export type MarkdownPart =
  | { kind: "markdown"; source: string }
  | { kind: "embed"; source: string; directive: WorkspaceDirective }
  | { kind: "preserved"; source: string }
  | { kind: "rich"; source: string; node: Record<string, unknown> }
  /** A collapsible toggle opens (`<details>` and its `<summary>`)… */
  | { kind: "toggle-start"; source: string; title: string; open: boolean }
  /** …and closes (`</details>`); what's between is split as usual. */
  | { kind: "toggle-end"; source: string };

const DETAILS_OPEN = /^<details(\s+open(?:=(?:""|"open"|'open'|open))?)?\s*>\s*(.*)$/i;
const DETAILS_CLOSE = /^<\/details>\s*$/i;
const SUMMARY = /^<summary>([\s\S]*?)<\/summary>\s*$/i;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
/** A toggle's title as plain text: tags, Markdown emphasis and entities taken out. */
function summaryText(html: string) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name: string) => ENTITIES[name])
    .replace(/^(\*\*|__)(.*)\1$/s, "$2")
    .trim();
}
/** Written back the same way, so `<summary>` can't be broken by what's typed in a title. */
export const escapeSummary = (title: string) =>
  title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, " ");

/**
 * The line where a toggle opened at `start` closes (`</details>` at the same depth, outside
 * code), or -1. Children may be indented one tab, as Notion writes them.
 */
function detailsEnd(lines: string[], start: number, indent: string) {
  let depth = 1;
  let fence = "";
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index].startsWith(indent) ? lines[index].slice(indent.length).replace(/^\t/, "") : lines[index];
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = "";
      continue;
    }
    if (fence) continue;
    const trimmed = line.trim();
    if (DETAILS_OPEN.test(trimmed)) depth++;
    else if (DETAILS_CLOSE.test(trimmed) && --depth === 0) return index;
  }
  return -1;
}

export function encodeDirective(value: WorkspaceDirective): string {
  return `:::slate ${JSON.stringify(value)}`;
}
export function decodeDirective(source: string): WorkspaceDirective | null {
  try {
    const data: unknown = JSON.parse(source.replace(/^:::slate\s+/, "").trim());
    if (!data || typeof data !== "object") return null;
    const value = data as Record<string, unknown>;
    if (!["database", "page"].includes(String(value.kind)) || typeof value.id !== "string") return null;
    return value as WorkspaceDirective;
  } catch {
    return null;
  }
}

/** Block types saved as `:::slate-node` JSON lines (anything else is kept as source). */
const RICH_NODES = ["callout", "toggle", "procedureParams", "procedureStep"];

/**
 * A line with its inline code (`<Tool>`, ``a `b` c``) blanked out: tags written as code are
 * text, so they mustn't turn a paragraph or table into a raw HTML block.
 */
const withoutCodeSpans = (line: string) => line.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, "");

/** Recognize directives only outside fenced code. Preserve unfamiliar block syntax verbatim. */
export function splitMarkdown(source: string): MarkdownPart[] {
  const lines = source.split("\n");
  const result: MarkdownPart[] = [];
  let pending: string[] = [];
  let fence = "";
  const flush = () => {
    if (pending.length) {
      result.push({ kind: "markdown", source: pending.join("\n") });
      pending = [];
    }
  };
  /** Open toggles: where each closes, and the indent its children carry (Notion's tab). */
  const toggles: { end: number; indent: string }[] = [];
  for (let index = 0; index < lines.length; index++) {
    const open = toggles[toggles.length - 1];
    if (open && index === open.end) {
      flush();
      result.push({ kind: "toggle-end", source: lines[index] });
      toggles.pop();
      continue;
    }
    const indent = open?.indent ?? "";
    const line = indent && lines[index].startsWith(indent) ? lines[index].slice(indent.length) : lines[index];
    const details = !fence && DETAILS_OPEN.exec(line.trim());
    if (details) {
      const end = detailsEnd(lines, index, indent);
      if (end > 0) {
        flush();
        // The title: on the same line, or the next one with text.
        let rest = details[2].trim();
        const raw = [lines[index]];
        if (!rest) {
          let next = index + 1;
          while (next < end && !lines[next].trim()) next++;
          if (next < end && SUMMARY.test(lines[next].trim())) {
            raw.push(...lines.slice(index + 1, next + 1));
            rest = lines[next].trim();
            index = next;
          }
        }
        const summary = SUMMARY.exec(rest);
        // Children all indented a tab further (Notion's export) lose that tab here.
        const inner = lines.slice(index + 1, end).filter((entry) => entry.trim());
        const childIndent =
          inner.length && inner.every((entry) => entry.startsWith(`${indent}\t`)) ? `${indent}\t` : indent;
        result.push({
          kind: "toggle-start",
          source: raw.join("\n"),
          title: summary ? summaryText(summary[1]) : "",
          open: Boolean(details[1]),
        });
        toggles.push({ end, indent: childIndent });
        // Text after </summary> on the same line is the toggle's first line.
        if (!summary && rest) pending.push(rest);
        continue;
      }
    }
    if (index === 0 && line.trim() === "---") {
      const closing = lines.findIndex((entry, offset) => offset > 0 && ["---", "..."].includes(entry.trim()));
      if (closing > 0) {
        result.push({
          kind: "preserved",
          source: lines.slice(0, closing + 1).join("\n"),
        });
        index = closing;
        continue;
      }
    }
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = "";
      pending.push(line);
      continue;
    }
    if (!fence && line.startsWith(":::slate ")) {
      flush();
      const directive = decodeDirective(line);
      result.push(directive ? { kind: "embed", source: line, directive } : { kind: "preserved", source: line });
    } else if (!fence && line.startsWith(":::slate-node ")) {
      flush();
      try {
        const node = JSON.parse(line.slice(":::slate-node ".length)) as Record<string, unknown>;
        result.push(
          RICH_NODES.includes(String(node.type))
            ? { kind: "rich", source: line, node }
            : { kind: "preserved", source: line },
        );
      } catch {
        result.push({ kind: "preserved", source: line });
      }
    } else if (!fence && /^:::[\w-]/.test(line)) {
      flush();
      const raw = [line];
      while (index + 1 < lines.length) {
        raw.push(lines[++index]);
        if (lines[index].trim() === ":::") break;
      }
      result.push({ kind: "preserved", source: raw.join("\n") });
    } else if (
      !fence &&
      /(?:<\/?[a-z][\w:-]*(?:\s[^>]*|\s*)\/?\s*>|<!--)|^\s*(?:\[\^[^\]]+\]:|\$\$)/i.test(withoutCodeSpans(line))
    ) {
      // Unknown HTML/math/footnotes stay editable in source rather than being silently stripped.
      flush();
      const raw = [line];
      const text = withoutCodeSpans(line);
      const commentStart = text.indexOf("<!--");
      const openTag = text.match(/<([a-z][\w:-]*)(?=[\s/>])/i)?.[1];
      const voidTag =
        openTag && /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(openTag);
      if (commentStart >= 0 && !text.slice(commentStart).includes("-->")) {
        while (index + 1 < lines.length) {
          raw.push(lines[++index]);
          if (lines[index].includes("-->")) break;
        }
      } else if (line.trim() === "$$") {
        while (index + 1 < lines.length) {
          raw.push(lines[++index]);
          if (lines[index].trim() === "$$") break;
        }
      } else if (openTag && !voidTag) {
        const tags = new RegExp(`<\\/?${openTag}(?=[\\s/>])[^>]*>`, "gi");
        const depthChange = (entry: string) =>
          (entry.match(tags) ?? []).reduce(
            (depth, tag) => depth + (tag.startsWith("</") ? -1 : /\/>$/.test(tag) ? 0 : 1),
            0,
          );
        let depth = depthChange(text);
        while (depth > 0 && index + 1 < lines.length) {
          raw.push(lines[++index]);
          depth += depthChange(withoutCodeSpans(lines[index]));
        }
      } else {
        while (index + 1 < lines.length && lines[index + 1].trim()) raw.push(lines[++index]);
      }
      result.push({ kind: "preserved", source: raw.join("\n") });
    } else pending.push(line);
  }
  flush();
  return result;
}

export function joinMarkdown(parts: MarkdownPart[]): string {
  return parts.map((part) => part.source).join("\n");
}

export function fencedCode(code: string, language = ""): string {
  const runs = code.match(/`+/g) || [];
  const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  return `${fence}${language.replace(/[^a-zA-Z0-9_+-]/g, "")}\n${code}\n${fence}`;
}

export function safeImageUrl(value: string): string | null {
  // Private uploads are resolved by the authenticated application route. Accept
  // only its exact UUID path, never arbitrary relative or protocol-relative URLs.
  if (/^\/api\/attachments\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
