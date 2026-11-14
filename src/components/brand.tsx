import { useId } from "react";

/**
 * Slate's mark: three stacked slates (pages) on a blue tile. Readable down to 16px
 * and identical in light and dark themes.
 */
export function BrandMark({ size = 22 }: { size?: number }) {
  const gradient = `slate-tile-${useId().replace(/:/g, "")}`;
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4c9bf0" />
          <stop offset="1" stopColor="#1f5fd1" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gradient})`} />
      <path
        d="M32 14.5 49 23 32 31.5 15 23Z"
        fill="#fff"
        stroke="#fff"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M14.5 32 32 40.75 49.5 32"
        fill="none"
        stroke="#fff"
        strokeOpacity=".78"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.5 41 32 49.75 49.5 41"
        fill="none"
        stroke="#fff"
        strokeOpacity=".5"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Mark plus wordmark. */
export function Brand({ size = 22 }: { size?: number }) {
  return (
    <span className="brand">
      <BrandMark size={size} />
      <span className="brand-name">Slate</span>
    </span>
  );
}
