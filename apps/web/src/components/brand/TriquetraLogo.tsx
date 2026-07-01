/**
 * TriForge brand mark — an inline SVG *recreation* of the triquetra (Trinity knot) from
 * the product logo: three interlocking vesica loops in a blue→cyan gradient. It is a
 * scalable, themeable recreation (not the owner's exact source asset), so it needs no
 * binary file and adapts to any size/color context.
 */

import React from "react";

export interface TriquetraLogoProps {
  size?: number;
  /** Adds a soft outer glow (used on login / brand headers). */
  glow?: boolean;
  className?: string;
  /** Unique-ish suffix so multiple instances don't share gradient ids. */
  idSuffix?: string;
}

export function TriquetraLogo({ size = 40, glow = false, className, idSuffix = "a" }: TriquetraLogoProps): JSX.Element {
  const gid = `tf-tri-grad-${idSuffix}`;
  const gid2 = `tf-tri-grad2-${idSuffix}`;
  // One vertical vesica centered on (32,32); rotated 120° / 240° for the other two.
  const petal = "M32 12 C 20.5 18, 20.5 34, 32 40 C 43.5 34, 43.5 18, 32 12 Z";
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="TriForge"
      style={glow ? { filter: "drop-shadow(0 0 16px rgba(58,157,255,0.5))" } : undefined}
    >
      <defs>
        <linearGradient id={gid} x1="12" y1="8" x2="52" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5cb2ff" />
          <stop offset="0.55" stopColor="#3a9dff" />
          <stop offset="1" stopColor="#1aa5bd" />
        </linearGradient>
        <linearGradient id={gid2} x1="52" y1="12" x2="16" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#29d3ee" />
          <stop offset="1" stopColor="#2b7fd4" />
        </linearGradient>
      </defs>
      <g
        stroke={`url(#${gid})`}
        strokeWidth={4.4}
        strokeLinejoin="round"
        fill="none"
        transform="translate(0 1)"
      >
        <path d={petal} opacity={0.95} />
        <path d={petal} transform="rotate(120 32 32)" opacity={0.9} stroke={`url(#${gid2})`} />
        <path d={petal} transform="rotate(240 32 32)" opacity={0.92} />
      </g>
    </svg>
  );
}
