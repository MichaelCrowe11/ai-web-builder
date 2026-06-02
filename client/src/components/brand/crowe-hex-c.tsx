import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Crowe Logic corporate identity mark (hex C). Vendored from
 * @crowe/design-system@0.1.0 (marks/CorporateHexC.tsx); cx swapped for the app's
 * cn and the default stroke retargeted to --crowe-parchment (the app has no
 * --crowe-ink token). Use on corporate surfaces: header, footer, marketing.
 * Never composed with the assistant swirl (chat-only mark).
 */
export interface CroweHexCProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number;
  monochrome?: boolean;
}

export function CroweHexC({ size = 28, monochrome = false, className, ...rest }: CroweHexCProps) {
  const stroke = monochrome ? "currentColor" : "var(--crowe-parchment)";
  const accent = monochrome ? "currentColor" : "var(--crowe-gold)";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="Crowe Logic"
      className={cn(className)}
      {...rest}
    >
      <polygon
        points="24,3 42,13.5 42,34.5 24,45 6,34.5 6,13.5"
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="miter"
      />
      <path
        d="M31 17.5c-2-2-4.5-3-7.5-3-5 0-9 4-9 9.5s4 9.5 9 9.5c3 0 5.5-1 7.5-3"
        fill="none"
        stroke={accent}
        strokeWidth="2.25"
        strokeLinecap="square"
      />
    </svg>
  );
}
