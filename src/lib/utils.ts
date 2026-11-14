import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export function id() { return crypto.randomUUID(); }

/** Short, human relative time: "just now", "5 min ago", "Yesterday", "Mar 4". */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((now - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return 'Yesterday';
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(new Date(then).getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
}

/** Smooth scrolling, unless the person asked their device for less motion. */
export const scrollBehavior = (): ScrollBehavior =>
  typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
