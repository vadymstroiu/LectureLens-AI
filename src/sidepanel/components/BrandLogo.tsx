import { useId } from 'react';

/**
 * Props for the LectureLens AI unified brand mark component.
 */
export interface BrandLogoProps {
  /** Rendered pixel width and height of the square logo. Defaults to 28. */
  size?: number;
  /** Optional CSS classes applied to the SVG element. */
  className?: string;
}

/**
 * Unified LectureLens AI vector brand mark matching the Chrome extension icons.
 */
export function BrandLogo({ size = 28, className }: BrandLogoProps) {
  const gradientId = useId();

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="0"
          y1="0"
          x2="128"
          y2="128"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="128" height="128" rx="28" fill={`url(#${gradientId})`} />
      <rect
        x="1.5"
        y="1.5"
        width="125"
        height="125"
        rx="26.5"
        stroke="#FFFFFF"
        strokeOpacity="0.18"
        strokeWidth="3"
      />
      <circle cx="64" cy="64" r="27" fill="#FFFFFF" fillOpacity="0.14" />
      <circle cx="64" cy="64" r="39" stroke="#FFFFFF" strokeOpacity="0.92" strokeWidth="7" />
      <path
        d="M 64 41 C 64 56 72 64 87 64 C 72 64 64 72 64 87 C 64 72 56 64 41 64 C 56 64 64 56 64 41 Z"
        fill="#FFFFFF"
      />
      <path
        d="M 92 27 C 92 31.5 94.5 34 99 34 C 94.5 34 92 36.5 92 41 C 92 36.5 89.5 34 85 34 C 89.5 34 92 31.5 92 27 Z"
        fill="#FDE68A"
      />
    </svg>
  );
}
