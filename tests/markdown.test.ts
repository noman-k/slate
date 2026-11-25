import { describe, it, expect } from "vitest";
import {
  splitMarkdown,
  joinMarkdown,
  encodeDirective,
  decodeDirective,
  fencedCode,
  safeImageUrl,
} from "../src/lib/markdown";

describe("lossless Markdown source representation", () => {
  it("preserves nested lists, task lists, GFM tables and code byte-for-byte", () => {
    const source =
      '# Notes\n\n- parent\n  - child\n    1. nested\n- [ ] task\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst text = "`hello`"\n```\n';
    expect(joinMarkdown(splitMarkdown(source))).toBe(source);
  });
  it("preserves database IDs, selected views and nested page references", () => {
    const database = {
      kind: "database" as const,
      id: "db-123",
      viewId: "view-456",
    };
    const source = `## My database\n\n${encodeDirective(database)}\n\n${encodeDirective({ kind: "page", id: "page-789", title: "Child page" })}\n\nAfter the database.`;
    const parts = splitMarkdown(source);
    expect(parts.filter((part) => part.kind === "embed")).toHaveLength(2);
    expect(joinMarkdown(parts)).toBe(source);
    expect(decodeDirective(encodeDirective(database))).toEqual(database);
  });
  it("does not interpret directives inside code fences as embedded databases", () => {
    const source = '```md\n:::slate {"kind":"database","id":"example"}\n```';
    expect(splitMarkdown(source)).toEqual([{ kind: "markdown", source }]);
  });
  it("preserves unknown directives, malformed embeds, HTML and footnotes", () => {
    const source =
      "Before\n\n:::future\nsome content\n:::\n\n:::slate {bad json}\n\n<div>unsafe HTML is preserved as source</div>\n\n[^1]: Footnote\n\nAfter";
    expect(joinMarkdown(splitMarkdown(source))).toBe(source);
    expect(splitMarkdown(source).filter((part) => part.kind === "preserved")).toHaveLength(4);
  });
  it("uses a longer code fence when a code sample contains backtick fences", () => {
    expect(fencedCode("```markdown\nexample\n```", "md")).toBe("````md\n```markdown\nexample\n```\n````");
  });
  it("treats tags written as inline code as text, not raw HTML", () => {
    const source =
      'The home page renders the **same** `<Tool>` component.\n\n| URL | Renders |\n| --- | --- |\n| `/` | `<Tool initialMode="detect">` + `<Education>` |\n| `/account` | ``<Account reset={false}>`` |';
    const parts = splitMarkdown(source);
    expect(parts.map((part) => part.kind)).toEqual(["markdown"]);
    // Real HTML next to code is still kept as source.
    expect(splitMarkdown("Use `<b>` like <b>this</b>").map((part) => part.kind)).toEqual(["preserved"]);
    expect(splitMarkdown("A `<div>` example.\n\n<div>\nraw\n</div>").map((part) => part.kind)).toEqual([
      "markdown",
      "preserved",
    ]);
  });
  it("preserves nested callout and toggle document nodes", () => {
    const node = {
      type: "toggle",
      attrs: { title: "Details", open: false },
      content: [
        {
          type: "callout",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Keep this text" }],
            },
          ],
        },
      ],
    };
    const source = `Before\n\n:::slate-node ${JSON.stringify(node)}\n\nAfter`;
    expect(joinMarkdown(splitMarkdown(source))).toBe(source);
    expect(splitMarkdown(source).find((part) => part.kind === "rich")).toMatchObject({ kind: "rich", node });
  });
  it("preserves YAML frontmatter explicitly rather than changing it into headings", () => {
    const source = "---\ntitle: My page\ntags: [one, two]\n---\n\n# Hello";
    expect(splitMarkdown(source)[0]).toEqual({
      kind: "preserved",
      source: "---\ntitle: My page\ntags: [one, two]\n---",
    });
    expect(joinMarkdown(splitMarkdown(source))).toBe(source);
  });
  it("permits only the exact private attachment image route", () => {
    const path = "/api/attachments/00000000-0000-4000-8000-000000000001";
    expect(safeImageUrl(path)).toBe(path);
    for (const unsafe of [
      "//example.com/image.png",
      "/api/attachments/../admin",
      "/api/attachments/invalid",
      path + "?redirect=https://example.com",
      "/other-image.png",
      "blob:https://example.com/image",
    ])
      expect(safeImageUrl(unsafe)).toBeNull();
  });
  it("rejects unsafe image URLs", () => {
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
    expect(safeImageUrl("data:text/html,test")).toBeNull();
    expect(safeImageUrl("https://example.com/image.png")).toBe("https://example.com/image.png");
  });
});
