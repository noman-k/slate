import { describe, expect, it } from "vitest";
import { createSeedState } from "./fixtures/seed";
import { forStorage } from "../src/lib/persistence";

describe("forStorage", () => {
  it("rounds column widths to whole pixels in range, so a save can't fail on one", () => {
    const state = createSeedState();
    const [first, second, third] = state.properties;
    first.width = 231.98046875;
    second.width = 9999;
    third.width = Number.NaN;
    const saved = forStorage(state);
    expect(saved.properties.slice(0, 3).map((p) => p.width)).toEqual([232, 3000, 180]);
    // The rest, and the state it was given, are left alone.
    expect(saved.properties.slice(3)).toEqual(state.properties.slice(3));
    expect(first.width).toBe(231.98046875);
  });
  it("returns the same state when every width already fits", () => {
    const state = createSeedState();
    expect(forStorage(state)).toBe(state);
  });
});
