"use client";
import { Monitor, Moon, Sun } from "lucide-react";
import { Toaster } from "sonner";
import { useReapplyTheme, useTheme, type ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

/** System / Light / Dark segmented control. `compact` shows icons only. */
export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { preference, choose } = useTheme();
  return (
    <div className={`theme-switcher ${compact ? "compact" : ""}`} role="radiogroup" aria-label="Theme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          aria-label={compact ? `${label} theme` : undefined}
          title={compact ? `${label} theme` : undefined}
          className={preference === value ? "active" : ""}
          onClick={() => choose(value)}
        >
          <Icon size={compact ? 14 : 15} />
          {!compact && <span>{label}</span>}
        </button>
      ))}
    </div>
  );
}

/** Toasts that match the current theme. */
export function ThemedToaster() {
  useReapplyTheme();
  const { theme } = useTheme();
  return <Toaster theme={theme} position="bottom-right" closeButton toastOptions={{ className: "slate-toast" }} />;
}
