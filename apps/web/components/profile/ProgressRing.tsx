import type { CSSProperties } from 'react';

export interface ProgressRingProps {
  /** 0 to 100; anything outside is clamped and a `NaN` reads as 0. */
  percent: number;
  /** The ring's box in px. */
  size?: number;
  /** The centred text, formatted by the host from the catalog ("33%"). */
  label: string;
}

/** `percent` held to 0..100 (`NaN` is 0, `Infinity` is 100). */
export function clampPercent(percent: number): number {
  if (Number.isNaN(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}

/**
 * A progress ring (2026-10-12, `/perfil`'s "Perfil completo"): the `brand-soft` track, the `brand`
 * arc from twelve o'clock clockwise (the SVG turned -90°) and the host's label in the middle.
 *
 * **The arc is measured in percent, not in pixels**: `pathLength={100}` makes the circle 100 long
 * whatever its radius, so a dash of 100 offset by `100 - percent` shows exactly `percent`. The
 * offset reaches CSS through `--ring-offset`, and the arc grows from empty on its first paint
 * (`@starting-style` through Tailwind's `starting:`, a CSS transition, no script); under reduced
 * motion it is drawn at once. At 0 there is no arc at all: a round cap would still paint a dot.
 *
 * The stroke is `max(3, round(size / 11))` in viewBox units (6 at 64px). The SVG is decorative
 * (`aria-hidden`); the label is the readable value, so the ring never carries words of its own.
 */
export function ProgressRing({ percent, size = 64, label }: ProgressRingProps) {
  const value = clampPercent(percent);
  const stroke = Math.max(3, Math.round(size / 11));
  const radius = (64 - stroke) / 2;
  const ringStyle = { '--ring-offset': String(100 - value) } as CSSProperties;
  return (
    <span
      data-progress-ring
      data-percent={value}
      className="relative inline-grid shrink-0"
      style={{ width: size, height: size }}
    >
      <svg aria-hidden viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle
          cx={32}
          cy={32}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-brand-soft"
        />
        {value > 0 ? (
          <circle
            data-ring-arc
            cx={32}
            cy={32}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={100}
            className="stroke-brand transition-[stroke-dashoffset] duration-700 ease-out [stroke-dashoffset:var(--ring-offset)] starting:[stroke-dashoffset:100] motion-reduce:transition-none"
            style={ringStyle}
          />
        ) : null}
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-extrabold text-text">
        {label}
      </span>
    </span>
  );
}
