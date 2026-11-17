import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { createDocumentExtensions, parseDocument } from "../src/components/editor/extensions";
import { encodeDirective } from "../src/lib/markdown";

const extensions = createDocumentExtensions();
const manager = new MarkdownManager({
  extensions,
  markedOptions: { gfm: true },
});
const documentApi = { schema: getSchema(extensions), markdown: manager };

function roundTrip(source: string) {
  const first = parseDocument(documentApi, source);
  const markdown = manager.serialize(first);
  const second = parseDocument(documentApi, markdown);
  return { first, markdown, second };
}

describe("interactive editor / Markdown round-trip", () => {
  it("retains nested lists, task lists, tables, formatting and fenced code as real nodes", () => {
    const source =
      "## Notes\n\n**Bold** and *italic* with `inline code`.\n\n- Parent\n  - Child\n    1. Nested number\n\n- [ ] Open task\n- [x] Done task\n\n| Name | Value |\n| --- | --- |\n| First | 1 |\n\n````markdown\n```js\nconst example = 1;\n```\n````";
    const { first, second } = roundTrip(source);
    expect(first.content?.some((node) => node.type === "heading")).toBe(true);
    expect(first.content?.some((node) => node.type === "taskList")).toBe(true);
    expect(first.content?.some((node) => node.type === "table")).toBe(true);
    expect(first.content?.some((node) => node.type === "codeBlock")).toBe(true);
    expect(second).toEqual(first);
  });
  it("retains stable private attachment URLs without signing them into Markdown", () => {
    const path = "/api/attachments/00000000-0000-4000-8000-000000000001";
    const { first, second, markdown } = roundTrip(`![Payment receipt](${path})`);
    expect(first.content?.some((node) => node.type === "image" && node.attrs?.src === path)).toBe(true);
    expect(second).toEqual(first);
    expect(markdown).toContain(path);
  });
  it("retains embedded database IDs, view IDs and nested page links", () => {
    const source = `Before\n\n${encodeDirective({ kind: "database", id: "ledger-db", viewId: "paid-view" })}\n\n${encodeDirective({ kind: "page", id: "child-page", title: "Child page" })}\n\nAfter`;
    const { first, second, markdown } = roundTrip(source);
    expect(second).toEqual(first);
    expect(markdown).toContain("ledger-db");
    expect(markdown).toContain("paid-view");
    expect(markdown).toContain("child-page");
  });
  it("keeps unsupported syntax in explicit preserved source nodes", () => {
    const raw = ":::future-block\nKeep **this** exactly.\n:::";
    const { first, second, markdown } = roundTrip(`Before\n\n${raw}\n\nAfter`);
    expect(first.content?.find((node) => node.type === "preservedSource")?.attrs?.source).toBe(raw);
    expect(markdown).toContain(raw);
    expect(second).toEqual(first);
  });
  it("preserves multiline unknown HTML and comments including blank lines", () => {
    const raw = "<div>\n  <div>nested content</div>\n\n  More content\n</div>";
    const comment = "<!-- Keep this comment\n\nincluding its blank lines -->";
    const { first, second, markdown } = roundTrip(`${raw}\n\n${comment}`);
    expect(first.content?.filter((node) => node.type === "preservedSource").map((node) => node.attrs?.source)).toEqual([
      raw,
      comment,
    ]);
    expect(second).toEqual(first);
    expect(markdown).toContain(raw);
    expect(markdown).toContain(comment);
  });
  it("doesn't add an empty paragraph between a table and the block after it on each save", () => {
    let markdown = `| a | b |\n| --- | --- |\n| 1 | 2 |\n\n:::slate-node ${JSON.stringify({ type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] })}\n`;
    for (let i = 0; i < 3; i++) {
      const doc = parseDocument(documentApi, markdown);
      expect(doc.content?.map((node) => node.type)).toEqual(["table", "callout"]);
      markdown = manager.serialize(doc);
    }
  });
  it("retains nested callouts and collapsed toggles through source edits", () => {
    const node = {
      type: "toggle",
      attrs: { title: "Details", open: false },
      content: [
        {
          type: "callout",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Remember this" }],
            },
          ],
        },
      ],
    };
    const { first, second } = roundTrip(`:::slate-node ${JSON.stringify(node)}`);
    expect(first.content?.[0].type).toBe("toggle");
    expect(second).toEqual(first);
  });
  it("reads <details> as a toggle and saves toggles that way, with what's inside as Markdown", () => {
    const source =
      "Before\n\n<details>\n<summary>Plan &amp; <b>budget</b></summary>\n\n- One\n- Two\n\n<details open><summary>**Inner**</summary>\n\nDeep `code`\n\n</details>\n\n</details>\n\nAfter";
    const { first, markdown, second } = roundTrip(source);
    expect(first.content?.map((node) => node.type)).toEqual(["paragraph", "toggle", "paragraph"]);
    const toggle = first.content![1];
    expect(toggle.attrs).toEqual({ title: "Plan & budget", open: false });
    expect(toggle.content?.map((node) => node.type)).toEqual(["bulletList", "toggle"]);
    expect(toggle.content![1].attrs).toEqual({ title: "Inner", open: true });
    expect(markdown).toContain("<details>\n<summary>Plan &amp; budget</summary>\n\n- One\n- Two");
    expect(markdown).toContain("<details open>\n<summary>Inner</summary>\n\nDeep `code`\n\n</details>");
    expect(markdown).not.toContain(":::slate-node");
    expect(second).toEqual(first);
  });
  it("reads Notion's toggles, children indented a tab, and keeps embeds inside them", () => {
    const embed = encodeDirective({ kind: "database", id: "ledger-db" });
    const source = `<details>\n<summary>Tax-time review</summary>\n\t- Use year filters\n\t- Keep receipts\n\t${embed}\n</details>`;
    const { first, second, markdown } = roundTrip(source);
    const toggle = first.content![0];
    expect(toggle.type).toBe("toggle");
    expect(toggle.attrs?.title).toBe("Tax-time review");
    expect(toggle.content?.map((node) => node.type)).toEqual(["bulletList", "workspaceEmbed"]);
    expect(toggle.content![1].attrs?.id).toBe("ledger-db");
    expect(markdown).toContain(`\n${embed}\n`);
    expect(second).toEqual(first);
  });
  it("turns a toggle saved the old way into <details> on the next save", () => {
    const node = {
      type: "toggle",
      attrs: { title: "a < b", open: true },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Inside" }] }],
    };
    const { markdown, second } = roundTrip(`:::slate-node ${JSON.stringify(node)}`);
    expect(markdown).toBe("<details open>\n<summary>a &lt; b</summary>\n\nInside\n\n</details>");
    expect(second.content![0]).toEqual(node);
  });
  it("leaves <details> without a closing tag, or one inside code, as it was", () => {
    const unclosed = parseDocument(documentApi, "<details>\n<summary>Never closed</summary>\n\nText");
    expect(unclosed.content?.some((node) => node.type === "toggle")).toBe(false);
    const fenced = parseDocument(documentApi, "```html\n<details>\n<summary>x</summary>\n</details>\n```");
    expect(fenced.content?.map((node) => node.type)).toEqual(["codeBlock"]);
    const empty = parseDocument(documentApi, "<details>\n<summary>Empty</summary>\n</details>");
    expect(empty.content![0]).toEqual({
      type: "toggle",
      attrs: { title: "Empty", open: false },
      content: [{ type: "paragraph" }],
    });
  });
});
