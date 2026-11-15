/**
 * The "/" menu's commands: every block a page can insert (text, lists, media, databases,
 * playbook steps…), and how a search narrows them (a playbook shows its steps first).
 */

import type { Editor } from "@tiptap/core";

import {
  Link2,
  Heading1,
  Heading2,
  Heading3,
  List,
  KanbanSquare,
  ListOrdered,
  CheckSquare,
  Quote,
  Minus,
  Table2,
  ImageIcon,
  FileText,
  Database,
  ChevronRight,
  Info,
  CircleHelp,
  Code2,
  Compass,
  Flag,
  Globe,
  ListChecks,
  MessageSquare,
  SlidersHorizontal,
  Split,
} from "lucide-react";

import { type DatabaseChoice } from "./DatabasePicker";

import { popoverNearSelection } from "./editor-layout";
import type { Dispatch, SetStateAction } from "react";
import type { DocumentEditorProps } from "./DocumentEditor";
/** Where a popover sits (from popoverNearSelection). */
export type PopoverPosition = { top?: number; bottom?: number; left: number; maxHeight?: number };
/** The link or image address being asked for. */
export type UrlInput = { kind: "link" | "image"; value: string; position?: PopoverPosition } | null;
/** "/linked database": choosing an existing database (or a new one) to show here. */
export type DbPicker = { databases: DatabaseChoice[]; position?: PopoverPosition } | null;

export type SlashItem = {
  name: string;
  description: string;
  icon: typeof FileText;
  group: "Basic blocks" | "Media & embeds" | "Playbook steps" | "Templates" | "Steps" | "Text";
  /** Extra search words, so "/todo", "/ul" or "/img" find the right block. */
  keywords: string;
  run: (editor: Editor) => void;
};

/** What the commands need from the editor around them. */
export interface SlashContext {
  onCreatePage?: DocumentEditorProps["onCreatePage"];
  onCreateDatabase?: DocumentEditorProps["onCreateDatabase"];
  onUploadImage?: DocumentEditorProps["onUploadImage"];
  listDatabases?: DocumentEditorProps["listDatabases"];
  onInsertProcedure?: DocumentEditorProps["onInsertProcedure"];
  setDbPicker: Dispatch<SetStateAction<DbPicker>>;
  setUrlInput: Dispatch<SetStateAction<UrlInput>>;
}

export function buildSlashItems({
  onCreatePage,
  onCreateDatabase,
  onUploadImage,
  listDatabases,
  onInsertProcedure,
  setDbPicker,
  setUrlInput,
}: SlashContext): SlashItem[] {
  return [
    {
      name: "Text",
      group: "Basic blocks",
      keywords: "paragraph plain p normal",
      description: "Start writing with plain text",
      icon: FileText,
      run: (e) => {
        e.chain().focus().setParagraph().run();
      },
    },
    {
      name: "Heading 1",
      group: "Basic blocks",
      keywords: "h1 title big",
      description: "A large section heading",
      icon: Heading1,
      run: (e) => {
        e.chain().focus().toggleHeading({ level: 1 }).run();
      },
    },
    {
      name: "Heading 2",
      group: "Basic blocks",
      keywords: "h2 subtitle",
      description: "A medium section heading",
      icon: Heading2,
      run: (e) => {
        e.chain().focus().toggleHeading({ level: 2 }).run();
      },
    },
    {
      name: "Heading 3",
      group: "Basic blocks",
      keywords: "h3 small heading",
      description: "A small section heading",
      icon: Heading3,
      run: (e) => {
        e.chain().focus().toggleHeading({ level: 3 }).run();
      },
    },
    {
      name: "Bullet list",
      group: "Basic blocks",
      keywords: "ul unordered bullets dash",
      description: "Create a simple bulleted list",
      icon: List,
      run: (e) => {
        e.chain().focus().toggleBulletList().run();
      },
    },
    {
      name: "Numbered list",
      group: "Basic blocks",
      keywords: "ol ordered 1 numbers",
      description: "Create a numbered list",
      icon: ListOrdered,
      run: (e) => {
        e.chain().focus().toggleOrderedList().run();
      },
    },
    {
      name: "To-do list",
      group: "Basic blocks",
      keywords: "todo task checkbox check checklist",
      description: "Track a task with a checkbox",
      icon: CheckSquare,
      run: (e) => {
        e.chain().focus().toggleTaskList().run();
      },
    },
    {
      name: "Quote",
      group: "Basic blocks",
      keywords: "blockquote citation",
      description: "Capture a quote",
      icon: Quote,
      run: (e) => {
        e.chain().focus().toggleBlockquote().run();
      },
    },
    {
      name: "Callout",
      group: "Basic blocks",
      keywords: "note info tip highlight box",
      description: "Make something stand out",
      icon: Info,
      run: (e) => {
        e.chain()
          .focus()
          .insertContent({
            type: "callout",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Something to remember…" }],
              },
            ],
          })
          .run();
      },
    },
    {
      name: "Toggle",
      group: "Basic blocks",
      keywords: "collapse expand details fold",
      description: "Hide and show nested content",
      icon: ChevronRight,
      run: (e) => {
        e.chain()
          .focus()
          .insertContent({
            type: "toggle",
            attrs: { title: "Toggle", open: true },
            content: [{ type: "paragraph" }],
          })
          .run();
      },
    },
    {
      name: "Code block",
      group: "Media & embeds",
      keywords: "code snippet pre programming",
      description: "Code with syntax highlighting",
      icon: Code2,
      run: (e) => {
        e.chain().focus().toggleCodeBlock().run();
      },
    },
    {
      name: "Divider",
      group: "Basic blocks",
      keywords: "hr rule line separator",
      description: "Visually divide your content",
      icon: Minus,
      run: (e) => {
        e.chain().focus().setHorizontalRule().run();
      },
    },
    {
      name: "Table",
      group: "Media & embeds",
      keywords: "grid rows columns",
      description: "A simple table",
      icon: Table2,
      run: (e) => {
        e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      },
    },
    {
      name: "Page",
      group: "Media & embeds",
      keywords: "subpage nested link child",
      description: "Create a nested page",
      icon: FileText,
      run: (e) => {
        const id = onCreatePage?.();
        if (id)
          e.chain()
            .focus()
            .insertContent({
              type: "workspaceEmbed",
              attrs: { kind: "page", id },
            })
            .run();
      },
    },
    {
      name: "New database",
      group: "Media & embeds",
      keywords: "table db inline records",
      description: "Create a new database here",
      icon: Database,
      run: (e) => {
        const id = onCreateDatabase?.();
        if (id)
          e.chain()
            .focus()
            .insertContent([{ type: "workspaceEmbed", attrs: { kind: "database", id } }, { type: "paragraph" }])
            .run();
      },
    },
    {
      name: "Board view",
      group: "Media & embeds",
      keywords: "kanban database board columns cards",
      description: "A new database shown as a board",
      icon: KanbanSquare,
      run: (e) => {
        const id = onCreateDatabase?.("board");
        if (id)
          e.chain()
            .focus()
            .insertContent([{ type: "workspaceEmbed", attrs: { kind: "database", id } }, { type: "paragraph" }])
            .run();
      },
    },
    {
      name: "List view",
      group: "Media & embeds",
      keywords: "database list rows",
      description: "A new database shown as a list",
      icon: List,
      run: (e) => {
        const id = onCreateDatabase?.("list");
        if (id)
          e.chain()
            .focus()
            .insertContent([{ type: "workspaceEmbed", attrs: { kind: "database", id } }, { type: "paragraph" }])
            .run();
      },
    },
    ...(listDatabases
      ? [
          {
            name: "Link existing database",
            group: "Media & embeds",
            keywords: "existing link linked view reuse database table",
            description: "Show an existing database here",
            icon: Link2,
            run: (e: Editor) =>
              setDbPicker({
                databases: listDatabases(),
                position: popoverNearSelection(e, 380),
              }),
          } satisfies SlashItem,
        ]
      : []),
    {
      name: "Image",
      group: "Media & embeds",
      keywords: "img picture photo upload",
      description: onUploadImage ? "Upload a file or embed a link" : "Embed an image from a link",
      icon: ImageIcon,
      run: (e) => {
        setUrlInput({
          kind: "image",
          value: "",
          position: popoverNearSelection(e, onUploadImage ? 240 : 130),
        });
      },
    },
    {
      name: "Inputs",
      group: "Playbook steps",
      keywords: "parameters variables params fields form playbook runbook run",
      description: "What to ask for when someone presses Run",
      icon: SlidersHorizontal,
      run: (e) => {
        e.chain()
          .focus()
          .insertContent({
            type: "procedureParams",
            attrs: { params: [{ name: "", type: "text", required: true }] },
          })
          .run();
      },
    },
    ...(
      [
        [
          "send",
          "Say something",
          MessageSquare,
          "A message to send, or an instruction to follow",
          "send message tell reply instruction step",
        ],
        ["ask", "Ask a question", CircleHelp, "Ask, and remember the answer", "question collect input prompt step"],
        [
          "check",
          "Check something",
          ListChecks,
          "Do something and confirm it worked",
          "verify expected test runbook step",
        ],
        [
          "if",
          "Make a decision",
          Split,
          "Go a different way depending on a value",
          "if else condition branch decide when",
        ],
        [
          "api",
          "Call an app (API)",
          Globe,
          "Look something up or update another app",
          "api request http webhook fetch call endpoint get post rest json",
        ],
        ["end", "Finish", Flag, "End the run here", "end stop done exit step"],
      ] as const
    ).map(
      ([step, name, icon, description, keywords]) =>
        ({
          name,
          group: "Playbook steps",
          keywords: `step playbook runbook ${keywords}`,
          description,
          icon,
          run: (e: Editor) => {
            e.chain()
              .focus()
              .insertContent({
                type: "procedureStep",
                attrs: {
                  step,
                  ...(step === "ask" ? { answer: "text" } : {}),
                  ...(step === "if" ? { op: "is" } : {}),
                  ...(step === "api" ? { method: "GET" } : {}),
                },
              })
              .run();
          },
        }) satisfies SlashItem,
    ),
    ...(onInsertProcedure
      ? [
          {
            name: "Playbook",
            group: "Templates",
            keywords: "runbook procedure guide checklist sop steps workflow automation support ops incident deploy",
            description: "A new playbook page from a template, linked here",
            icon: Compass,
            run: (e: Editor) => {
              // A playbook is its own page: it's created from the chosen template and
              // linked here, on the line where "/" was typed.
              const at = e.state.selection.from;
              onInsertProcedure((pageId) => {
                e.chain()
                  .focus()
                  .setTextSelection(at)
                  .insertContent({ type: "workspaceEmbed", attrs: { kind: "page", id: pageId } })
                  .run();
              });
            },
          } satisfies SlashItem,
        ]
      : []),
  ];
}

/** The commands for a "/" search, best first (and, on an empty search in a playbook, its steps). */
export function filterSlashItems(
  allItems: SlashItem[],
  query: string,
  runnable: boolean | undefined,
  editor: Editor | null,
): SlashItem[] {
  query = query.toLowerCase();
  // Steps belong to playbooks, which are built in the playbook builder; on an
  // ordinary page they'd turn it into one mid-sentence.
  const items = runnable ? allItems : allItems.filter((item) => item.group !== "Playbook steps");
  const byGroup = (item: SlashItem) =>
    runnable ? (item.group === "Playbook steps" ? 0 : 1) : item.group === "Basic blocks" ? 0 : 1;
  if (!query && runnable) {
    // A playbook: steps first, then the few text blocks that suit one. Everything
    // else is still a search away.
    let hasInputs = false;
    editor?.state.doc.forEach((node) => {
      if (node.type.name === "procedureParams") hasInputs = true;
    });
    const steps = items
      .filter((item) => item.group === "Playbook steps" && !(hasInputs && item.name === "Inputs"))
      .sort((a, b) => Number(a.name === "Inputs") - Number(b.name === "Inputs"))
      .map((item) => ({ ...item, group: "Steps" as const }));
    const text = (
      [
        ["Text", null, null],
        ["Heading 2", "Section", "Start a new part (steps can jump to it)"],
        ["Heading 3", "Sub-heading", "A smaller heading inside a section"],
        ["Bullet list", null, null],
        ["Numbered list", null, null],
        ["To-do list", null, null],
        ["Callout", null, "A tip or warning people should notice"],
        ["Divider", null, null],
      ] as const
    ).flatMap(([name, rename, describe]) => {
      const item = items.find((i) => i.name === name);
      return item
        ? [{ ...item, group: "Text" as const, name: rename ?? item.name, description: describe ?? item.description }]
        : [];
    });
    return [...steps, ...text];
  }
  if (!query) return [...items].sort((a, b) => byGroup(a) - byGroup(b));
  // Names that start with the query first, then any match in name, keywords or description.
  const score = (item: SlashItem) => {
    const name = item.name.toLowerCase();
    if (name.startsWith(query)) return 0;
    if (name.includes(query)) return 1;
    if (item.keywords.split(" ").some((word) => word.startsWith(query))) return 2;
    return `${item.keywords} ${item.description}`.toLowerCase().includes(query) ? 3 : -1;
  };
  return (
    items
      .map((item) => ({ item, rank: score(item) }))
      .filter(({ rank }) => rank >= 0)
      // On a playbook, a step wins a tie with another block.
      .sort((a, b) => a.rank - b.rank || (runnable ? byGroup(a.item) - byGroup(b.item) : 0))
      .map(({ item }) => item)
  );
}
