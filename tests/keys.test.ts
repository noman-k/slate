import { describe, expect, it } from "vitest";
import { detectKeyPlatform, formatKeys, withKeys } from "../src/lib/keys";

describe("shortcuts per device", () => {
  it("uses Apple's symbols and order on Apple devices", () => {
    expect(formatKeys("Mod+K", "apple")).toBe("⌘K");
    expect(formatKeys("Mod+Shift+X", "apple")).toBe("⇧⌘X");
    expect(formatKeys("Shift+Mod+ArrowUp", "apple")).toBe("⇧⌘↑");
    expect(formatKeys("Alt+ArrowLeft", "apple")).toBe("⌥←");
    expect(formatKeys("Mod+\\", "apple")).toBe("⌘\\");
  });
  it("uses words joined by + on Windows and Linux", () => {
    expect(formatKeys("Mod+K", "other")).toBe("Ctrl+K");
    expect(formatKeys("Mod+Shift+X", "other")).toBe("Ctrl+Shift+X");
    expect(formatKeys("Shift+Mod+ArrowDown", "other")).toBe("Ctrl+Shift+↓");
    expect(formatKeys("Alt+ArrowLeft", "other")).toBe("Alt+←");
    expect(formatKeys("Mod+[", "other")).toBe("Ctrl+[");
  });
  it("leaves plain keys alone", () => {
    expect(formatKeys("/", "apple")).toBe("/");
    expect(formatKeys("Escape", "other")).toBe("Esc");
    expect(formatKeys("Mod++", "other")).toBe("Ctrl++");
  });
  it("labels tooltips", () => {
    expect(withKeys("Undo", "Mod+Z", "other")).toBe("Undo (Ctrl+Z)");
    expect(withKeys("Redo", "Shift+Mod+Z", "apple")).toBe("Redo (⇧⌘Z)");
  });
  it("knows Apple devices", () => {
    expect(detectKeyPlatform({ platform: "MacIntel" })).toBe("apple");
    expect(detectKeyPlatform({ platform: "iPhone" })).toBe("apple");
    expect(detectKeyPlatform({ userAgentData: { platform: "macOS" } })).toBe("apple");
    expect(detectKeyPlatform({ platform: "Win32" })).toBe("other");
    expect(detectKeyPlatform({ userAgentData: { platform: "Linux" } })).toBe("other");
  });
});
