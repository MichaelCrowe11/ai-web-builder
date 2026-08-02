import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The AI Web Builder monogram: an angular A, a lighter blade rising through its
 * right leg, and a spark.
 *
 * Redrawn as vector from the supplied artwork rather than shipped as that file.
 * The original is a raster with a grey field and a baked glow, which would sit
 * in a visible grey box against the header and turn to mush at favicon size.
 * This is four paths, so it stays crisp at 16px and carries no background.
 *
 * The gradient is the product's, not the parent's: blue through violet, which
 * is why the whole accent moved off the house gold (see styles/crowe/colors.css).
 * Crowe Logic gold survives in exactly one place, the endorsement lockup in the
 * footer, so the endorsement reads as an endorsement.
 *
 * `gradientId` exists because two of these render on the same page. SVG
 * gradient ids are document-global, so a fixed id means the second instance
 * silently repaints the first.
 */
export interface AiwbMarkProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number;
  /** Flat single-colour cut, for places a gradient cannot go. */
  tone?: "gradient" | "mono";
  title?: string;
  gradientId?: string;
}

export function AiwbMark({
  size = 28,
  tone = "gradient",
  title = "AI Web Builder",
  gradientId,
  className,
  ...rest
}: AiwbMarkProps) {
  const reactId = React.useId();
  const id = gradientId ?? `aiwb-${reactId}`;
  const stroke = tone === "gradient" ? `url(#${id})` : "currentColor";
  const blade = tone === "gradient" ? "var(--crowe-accent-soft, #7dd3fc)" : "currentColor";
  const spark = tone === "gradient" ? "#e0f2fe" : "currentColor";

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
      {tone === "gradient" && (
        <defs>
          <linearGradient id={id} x1="6" y1="44" x2="40" y2="6" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#2563eb" />
            <stop offset="0.5" stopColor="#38bdf8" />
            <stop offset="1" stopColor="#a855f7" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M8 42 L20.5 8 L33 42"
        fill="none"
        stroke={stroke}
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M26.5 42 L37 20"
        fill="none"
        stroke={blade}
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      <path
        d="M40 6 l1.5 3.6 3.6 1.5 -3.6 1.5 -1.5 3.6 -1.5 -3.6 -3.6 -1.5 3.6 -1.5 z"
        fill={spark}
      />
    </svg>
  );
}
