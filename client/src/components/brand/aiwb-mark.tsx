import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Two interlocking frames: a page becoming another page, and a site continuing
 * to change after launch. The mark is intentionally flat and geometric so it
 * holds at favicon size and never reads as the sparkle/wand shorthand used by
 * generic model wrappers.
 */
export interface AiwbMarkProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number;
  tone?: "duotone" | "mono";
  title?: string;
}

export function AiwbMark({
  size = 28,
  tone = "duotone",
  title = "Web Builder",
  className,
  ...rest
}: AiwbMarkProps) {
  const front = tone === "duotone" ? "var(--crowe-accent, #b8893a)" : "currentColor";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={title}
      className={cn(className)}
      {...rest}
    >
      <path
        d="M20 4H4v16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="square"
      />
      <path
        d="M12 12h16v16H12V12Z"
        fill="none"
        stroke={front}
        strokeWidth="2.5"
        strokeLinejoin="miter"
      />
    </svg>
  );
}
