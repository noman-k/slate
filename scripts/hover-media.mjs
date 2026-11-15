/**
 * Keeps hover styles to devices that can really hover.
 *
 * On touch screens a `:hover` rule that reveals or changes something makes Safari treat the
 * first tap as a hover, so people have to tap twice. This wraps every rule with `:hover` in
 * `@media (hover: hover)`, splitting off just the hover selectors when a rule mixes them with
 * others (such as `:focus-visible`, which keyboards still need everywhere).
 *
 *   node scripts/hover-media.mjs           # rewrite the CSS files
 *   node scripts/hover-media.mjs --check   # fail if any file has an unwrapped :hover rule
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";

const postcss = createRequire(import.meta.url)("postcss");
const check = process.argv.includes("--check");
const files = globSync("src/**/*.css");

const insideHoverMedia = (node) => {
  for (let parent = node.parent; parent; parent = parent.parent)
    if (parent.type === "atrule" && parent.name === "media" && /\(\s*hover\s*:\s*hover\s*\)/.test(parent.params))
      return true;
  return false;
};
const insideKeyframes = (node) => {
  for (let parent = node.parent; parent; parent = parent.parent)
    if (parent.type === "atrule" && /keyframes$/.test(parent.name)) return true;
  return false;
};

let unwrapped = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const root = postcss.parse(source);
  let changed = false;
  root.walkRules((rule) => {
    if (!rule.selector.includes(":hover") || insideHoverMedia(rule) || insideKeyframes(rule)) return;
    unwrapped += 1;
    if (check) {
      console.log(`${file}:${rule.source.start.line}  ${rule.selector.replace(/\s+/g, " ").slice(0, 100)}`);
      return;
    }
    const hover = rule.selectors.filter((s) => s.includes(":hover"));
    const rest = rule.selectors.filter((s) => !s.includes(":hover"));
    const media = postcss.atRule({
      name: "media",
      params: "(hover: hover)",
      raws: { before: rule.raws.before, afterName: " " },
    });
    const hoverRule = rule.clone({ selectors: hover });
    const multiline = (rule.raws.after || "").includes("\n");
    hoverRule.raws.before = multiline ? "\n  " : " ";
    if (multiline) {
      // Indent the copied rule one level, as if written inside the media query.
      hoverRule.selector = hoverRule.selector.replace(/\n/g, "\n  ");
      hoverRule.each((child) => {
        child.raws.before = (child.raws.before || "").replace(/\n/g, "\n  ");
      });
      hoverRule.raws.after = (hoverRule.raws.after || "").replace(/\n/g, "\n  ");
      media.raws.after = "\n";
    } else media.raws.after = " ";
    media.raws.between = " ";
    media.append(hoverRule);
    if (rest.length) {
      rule.selectors = rest;
      rule.after(media);
    } else rule.replaceWith(media);
    changed = true;
  });
  if (changed) writeFileSync(file, root.toString());
}
if (check) {
  if (unwrapped) {
    console.error(`\n${unwrapped} :hover rule(s) outside @media (hover: hover). Run: node scripts/hover-media.mjs`);
    process.exit(1);
  }
  console.log("All :hover rules are limited to devices that can hover.");
} else console.log(`Wrapped ${unwrapped} :hover rule(s).`);
