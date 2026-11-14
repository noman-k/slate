import { EditorSelection, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/** Formatting actions offered by the Markdown toolbar and shortcuts. */
export type MarkdownAction =
  | "h1" | "h2" | "h3" | "bold" | "italic" | "strike" | "code" | "link"
  | "quote" | "bullet" | "numbered" | "task" | "codeblock" | "divider";

/** Wraps the selection (or a placeholder) in markers, or unwraps if already wrapped. */
function wrap(view: EditorView, before: string, after: string, placeholder: string) {
  const { state } = view;
  view.dispatch(
    state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to);
      const outer = state.sliceDoc(range.from - before.length, range.to + after.length);
      if (!range.empty && outer === before + text + after)
        return {
          changes: [
            { from: range.from - before.length, to: range.from },
            { from: range.to, to: range.to + after.length },
          ],
          range: EditorSelection.range(range.from - before.length, range.to - before.length),
        };
      if (!range.empty && text.startsWith(before) && text.endsWith(after) && text.length >= before.length + after.length)
        return {
          changes: { from: range.from, to: range.to, insert: text.slice(before.length, text.length - after.length) },
          range: EditorSelection.range(range.from, range.to - before.length - after.length),
        };
      const body = text || placeholder;
      return {
        changes: { from: range.from, to: range.to, insert: before + body + after },
        range: EditorSelection.range(range.from + before.length, range.from + before.length + body.length),
      };
    }),
  );
}

/** Toggles a line prefix ("## ", "> ", "- ", …) on every selected line. */
function prefixLines(view: EditorView, prefix: string | "numbered") {
  const { state } = view;
  const lines = new Map<number, ReturnType<typeof state.doc.lineAt>>();
  for (const range of state.selection.ranges)
    for (let pos = range.from; pos <= range.to; ) {
      const line = state.doc.lineAt(pos);
      lines.set(line.number, line);
      pos = line.to + 1;
    }
  const all = [...lines.values()];
  const pattern = prefix === "numbered" ? /^\d+\.\s/ : new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  const removing = all.every((line) => pattern.test(line.text));
  // Headings and list markers replace each other instead of stacking.
  const existing = /^(#{1,6}\s|>\s|[-*+]\s\[[ xX]\]\s|[-*+]\s|\d+\.\s)/;
  view.dispatch({
    changes: all.map((line, index) => {
      const match = line.text.match(existing);
      const from = line.from;
      const to = line.from + (match ? match[0].length : 0);
      if (removing) return { from, to, insert: "" };
      return { from, to, insert: prefix === "numbered" ? `${index + 1}. ` : prefix };
    }),
  });
}

export function applyMarkdown(view: EditorView, action: MarkdownAction) {
  switch (action) {
    case "h1": prefixLines(view, "# "); break;
    case "h2": prefixLines(view, "## "); break;
    case "h3": prefixLines(view, "### "); break;
    case "quote": prefixLines(view, "> "); break;
    case "bullet": prefixLines(view, "- "); break;
    case "numbered": prefixLines(view, "numbered"); break;
    case "task": prefixLines(view, "- [ ] "); break;
    case "bold": wrap(view, "**", "**", "bold text"); break;
    case "italic": wrap(view, "_", "_", "italic text"); break;
    case "strike": wrap(view, "~~", "~~", "struck text"); break;
    case "code": {
      const multiline = view.state.selection.ranges.some((range) => view.state.sliceDoc(range.from, range.to).includes("\n"));
      if (multiline) wrap(view, "```\n", "\n```", "code");
      else wrap(view, "`", "`", "code");
      break;
    }
    case "codeblock": wrap(view, "```\n", "\n```", "code"); break;
    case "link": {
      const range = view.state.selection.main;
      const text = view.state.sliceDoc(range.from, range.to) || "link text";
      const insert = `[${text}](url)`;
      view.dispatch({
        changes: { from: range.from, to: range.to, insert },
        // Select "url" so it can be typed over straight away.
        selection: EditorSelection.range(range.from + text.length + 3, range.from + text.length + 6),
      });
      break;
    }
    case "divider": {
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      view.dispatch({ changes: { from: line.to, insert: `${line.text ? "\n" : ""}\n---\n` } });
      break;
    }
  }
  view.focus();
}

/** GitHub-style shortcuts; highest precedence so they beat CodeMirror defaults (Mod-i). */
export const markdownKeymap = Prec.highest(
  keymap.of(
    ([
      ["Mod-b", "bold"], ["Mod-i", "italic"], ["Mod-k", "link"], ["Mod-e", "code"],
      ["Mod-Shift-x", "strike"], ["Mod-Shift-7", "numbered"], ["Mod-Shift-8", "bullet"],
      ["Mod-Shift-.", "quote"],
    ] as [string, MarkdownAction][]).map(([key, action]) => ({
      key,
      run: (view: EditorView) => {
        applyMarkdown(view, action);
        return true;
      },
    })),
  ),
);

/** Syntax colors modeled on GitHub's dark theme. */
const githubHighlight = HighlightStyle.define([
  { tag: [t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6, t.heading], color: "var(--syntax-heading)", fontWeight: "600" },
  { tag: t.strong, color: "var(--syntax-text)", fontWeight: "700" },
  { tag: t.emphasis, color: "var(--syntax-text)", fontStyle: "italic" },
  { tag: t.strikethrough, color: "var(--syntax-comment)", textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--syntax-string)" },
  { tag: t.monospace, color: "var(--syntax-code)" },
  { tag: t.quote, color: "var(--syntax-comment)", fontStyle: "italic" },
  // Markdown punctuation: "#", "-", "1.", ">", "**", "`"… (t.list would color whole items).
  // Kept quiet so the words, not the markers, carry the page.
  { tag: t.processingInstruction, color: "var(--syntax-comment)" },
  { tag: t.contentSeparator, color: "var(--syntax-comment)" },
  { tag: [t.meta, t.comment], color: "var(--syntax-comment)" },
  { tag: [t.keyword, t.operator], color: "var(--syntax-keyword)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syntax-string)" },
  { tag: [t.number, t.bool, t.atom], color: "var(--syntax-number)" },
  { tag: [t.function(t.variableName), t.typeName, t.className], color: "var(--syntax-function)" },
]);

/** Editor chrome in the app's palette; the surrounding box supplies border and header. */
const githubTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", color: "var(--text)", fontSize: "13.5px" },
    ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.75" },
    ".cm-content": { padding: "16px 0 28px", minHeight: "220px", caretColor: "var(--text-strong)" },
    ".cm-line": { padding: "0 24px 0 10px" },
    // No divider: the gutter is only as tall as the text, so a border would stop short.
    ".cm-gutters": { backgroundColor: "transparent", color: "var(--text-tertiary)", border: "none" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 16px", minWidth: "40px", fontSize: "12px" },
    ".cm-activeLine": { backgroundColor: "var(--active-line)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-secondary)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text-strong)", borderLeftWidth: "1.5px" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--syntax-selection) !important" },
    ".cm-selectionMatch": { backgroundColor: "var(--syntax-match)" },
    ".cm-foldGutter .cm-gutterElement": { color: "var(--text-tertiary)", padding: "0 4px" },
    ".cm-foldPlaceholder": { backgroundColor: "var(--bg-raised)", border: "none", color: "var(--text-secondary)" },
    ".cm-tooltip": { backgroundColor: "var(--bg-elevated)", border: "none", boxShadow: "var(--shadow-popover)", borderRadius: "8px" },
    ".cm-panels": { backgroundColor: "var(--bg-sidebar)", color: "var(--text)" },
    ".cm-searchMatch": { backgroundColor: "var(--syntax-search)" },
    "&.cm-focused": { outline: "none" },
  },
);

export const githubMarkdownLook: Extension = [githubTheme, syntaxHighlighting(githubHighlight)];
