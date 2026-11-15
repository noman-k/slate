/**
 * Page icons for AI agents: a name like "rocket" or "chart-line", optionally with a color
 * ("rocket:purple"). A word that isn't an icon's name finds the icon it describes ("money"
 * finds wallet), and emoji map to the closest icon, so agents rarely need the exact list.
 */
import {
  PAGE_ICON_COLORS,
  PAGE_ICON_KEYWORDS,
  PAGE_ICON_SET,
  normalizePageIcon,
  type PageIconColor,
} from "@/components/page-icon";
import { ToolError } from "./agent-tools";

export const ICON_HINT =
  'An icon for the page: a name like "rocket", "house", "wallet", "calendar" or "chart-line", optionally with a color ' +
  `after a colon ("rocket:purple"). Colors: ${PAGE_ICON_COLORS.join(", ")}. A word or emoji finds the closest icon. "" removes it.`;

export const iconProp = { type: "string", maxLength: 60, description: ICON_HINT };

/** The stored icon ("" or "icon:<name>:<color>") for what an agent sent. */
export function agentIcon(raw: unknown): string {
  if (raw === null || raw === "") return "";
  if (typeof raw !== "string") throw new ToolError(`The icon must be text. ${ICON_HINT}`);
  const value = raw.trim();
  if (!value) return "";
  const asEmoji = normalizePageIcon(value);
  if (asEmoji) return asEmoji;
  const [rawName, rawColor] = value
    .replace(/^icon:/, "")
    .toLowerCase()
    .split(":");
  const color = (rawColor || "gray").trim();
  if (!(PAGE_ICON_COLORS as readonly string[]).includes(color))
    throw new ToolError(`“${rawColor}” isn't an icon color. Colors: ${PAGE_ICON_COLORS.join(", ")}.`);
  const wanted = rawName.trim().replace(/[\s_]+/g, "-");
  let name = PAGE_ICON_SET[wanted] ? wanted : "";
  if (!name) {
    // The icon whose name or keywords mention the word.
    const words = wanted.split("-").filter(Boolean);
    name =
      Object.keys(PAGE_ICON_KEYWORDS).find((icon) =>
        words.every((word) => PAGE_ICON_KEYWORDS[icon].split(/\s+/).includes(word)),
      ) ?? "";
  }
  if (!name)
    throw new ToolError(`There's no icon “${rawName}”. Icons: ${Object.keys(PAGE_ICON_SET).sort().join(", ")}.`);
  return `icon:${name}:${color as PageIconColor}`;
}
