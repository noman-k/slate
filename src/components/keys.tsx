"use client";
import { useSyncExternalStore } from "react";
import { detectKeyPlatform, formatKeys, withKeys, type KeyPlatform } from "@/lib/keys";

const noSubscription = () => () => {};

/** Which way to name keys on this device. Apple until the page is in the browser. */
export function useKeyPlatform(): KeyPlatform {
  return useSyncExternalStore(
    noSubscription,
    () => detectKeyPlatform(navigator as Navigator & { userAgentData?: { platform?: string } }),
    () => "apple",
  );
}

const TOUCH_ONLY = "(hover: none) and (pointer: coarse)";
/** A phone or tablet used by touch (no mouse or trackpad): keyboard shortcuts don't apply. */
export function useTouchOnly(): boolean {
  return useSyncExternalStore(
    (change) => {
      const query = matchMedia(TOUCH_ONLY);
      query.addEventListener("change", change);
      return () => query.removeEventListener("change", change);
    },
    () => matchMedia(TOUCH_ONLY).matches,
    () => false,
  );
}

/** A shortcut as this device names it: <Keys combo="Mod+K" /> shows ⌘K or Ctrl+K. */
export function Keys({ combo, className }: { combo: string; className?: string }) {
  const platform = useKeyPlatform();
  return <kbd className={className}>{formatKeys(combo, platform)}</kbd>;
}

/** Formats shortcuts for labels and tooltips on this device. */
export function useKeys() {
  const platform = useKeyPlatform();
  return {
    platform,
    keys: (combo: string) => formatKeys(combo, platform),
    withKeys: (label: string, combo: string) => withKeys(label, combo, platform),
  };
}
