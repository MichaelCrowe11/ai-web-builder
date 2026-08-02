import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The Trellis mark: a lattice panel with a gold node where the laths cross.
 *
 * The mark is the argument. A trellis is a hand-built structure that content
 * grows on and is guided by, which is exactly what the Site Document plus the
 * curated renderer are, and why the output cannot become slop. The lattice is
 * the structure; the gold node is the point on it that grows.
 *
 * It deliberately rhymes with the Crowe Logic rotor without copying it: both
 * are centred, radial, and carry a single gold core on a cream structure. That
 * is what an endorsed product mark should do. Do not swap the node for the
 * rotor's hexagon, and never recolour the gold by inverting: inverting #EFA71B
 * yields a blue, the one colour the house does not own.
 *
 * Drawn as four strokes and a circle so it survives 16px. Verified by
 * rasterising at 16, 24, 32 and 48 and comparing at 4x.
 */
export interface TrellisMarkProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number;
  /** "dark" = cream lattice for dark chrome (default). "light" = ink on paper. */
  tone?: "dark" | "light";
  title?: string;
}

export function TrellisMark({
  size = 28,
  tone = "dark",
  title = "Trellis",
  className,
  ...rest
}: TrellisMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label={title}
      className={cn(className)}
      {...rest}
    >
      <g
        fill="none"
        stroke={tone === "dark" ? "#f5f2ea" : "#1a1714"}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M24 2 L46 24 L24 46 L2 24 Z" />
        <path d="M13 13 L35 35" />
        <path d="M35 13 L13 35" />
      </g>
      <circle cx="24" cy="24" r="4.4" fill="#EFA71B" />
    </svg>
  );
}
