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
  | { kind: "rich"; source: string; node: Record<string, unknown> };

export function encodeDirective(value: WorkspaceDirective): string {
  return `:::slate ${JSON.stringify(value)}`;
}
export function decodeDirective(source: string): WorkspaceDirective | null {
  try {
    const data: unknown = JSON.parse(source.replace(/^:::slate\s+/, "").trim());
    if (!data || typeof data !== "object") return null;
    const value = data as Record<string, unknown>;
    if (
      !["database", "page"].includes(String(value.kind)) ||
      typeof value.id !== "string"
    )
      return null;
    return value as WorkspaceDirective;
  } catch {
    return null;
  }
}

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
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (index === 0 && line.trim() === "---") {
      const closing = lines.findIndex(
        (entry, offset) => offset > 0 && ["---", "..."].includes(entry.trim()),
      );
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
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length)
        fence = "";
      pending.push(line);
      continue;
    }
    if (!fence && line.startsWith(":::slate ")) {
      flush();
      const directive = decodeDirective(line);
      result.push(
        directive
          ? { kind: "embed", source: line, directive }
          : { kind: "preserved", source: line },
      );
    } else if (!fence && line.startsWith(":::slate-node ")) {
      flush();
      try {
        const node = JSON.parse(line.slice(":::slate-node ".length)) as Record<
          string,
          unknown
        >;
        result.push(
          ["callout", "toggle"].includes(String(node.type))
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
      /(?:<\/?[a-z][\w:-]*(?:\s[^>]*|\s*)\/?\s*>|<!--)|^\s*(?:\[\^[^\]]+\]:|\$\$)/i.test(
        line,
      )
    ) {
      // Unknown HTML/math/footnotes stay editable in source rather than being silently stripped.
      flush();
      const raw = [line];
      const commentStart = line.indexOf("<!--");
      const openTag = line.match(/<([a-z][\w:-]*)(?=[\s/>])/i)?.[1];
      const voidTag =
        openTag &&
        /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(
          openTag,
        );
      if (commentStart >= 0 && !line.slice(commentStart).includes("-->")) {
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
            (depth, tag) =>
              depth + (tag.startsWith("</") ? -1 : /\/>$/.test(tag) ? 0 : 1),
            0,
          );
        let depth = depthChange(line);
        while (depth > 0 && index + 1 < lines.length) {
          raw.push(lines[++index]);
          depth += depthChange(lines[index]);
        }
      } else {
        while (index + 1 < lines.length && lines[index + 1].trim())
          raw.push(lines[++index]);
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
  if (
    /^\/api\/attachments\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    return value;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
