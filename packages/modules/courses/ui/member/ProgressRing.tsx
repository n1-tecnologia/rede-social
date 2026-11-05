import type { CSSProperties } from 'react';

/**
 * The module band's progress ring (08.5-07, UI-D-429, UI-D-443, accent item P-08.5), ported from the
 * prototype's `ProgressRing`: the brand stroke (`var(--color-brand)`) on a `white/25` track, the arc
 * starting at twelve o'clock.
 *
 * **Decorative.** `aria-hidden`: the band's accessible name already carries "{percent}% concluído",
 * so the ring repeats nothing to a screen reader. Props only, no words.
 *
 * **08.6-10 (UI-D-457, UI-D-458).** An optional centred `label` (the host's formatted "{percent}%",
 * `tabular-nums`, `aria-hidden` like the ring) for the Progresso ring at 88px, and a `tone`: `media`
 * (the default, the `white/25` track over a cover) or `page` (the neutral `bg-tertiary` track on a
 * card).
 *
 * **2026-10-22 (the courses area redesign on the social-igoralves prototype).** The arc DRAWS in
 * 0.8 s, the prototype's motion, as the CSS `animate-ring-draw`: the keyframe starts from the full
 * circumference, which the arc carries as `--ring-c`, and ends at its own `stroke-dashoffset`, so a
 * server-rendered ring animates with no hydration and a static render is exact. Under "reduzir
 * movimento" it rests drawn (`motion-reduce:animate-none`). The label is 800, the prototype's weight.
 */
export interface ProgressRingProps {
  /** 0–100; clamped here so a stray value cannot overdraw the circle. */
  percent: number;
  /** Diameter in px; the band uses 34 (the default stays 32). */
  size?: number;
  /** The host's formatted "{percent}%", centred over the ring; absent on the band. */
  label?: string;
  /** `media` → the `white/25` track (over a cover, the default) · `page` → `bg-tertiary` (a card). */
  tone?: 'media' | 'page';
  className?: string;
}

export function ProgressRing({
  percent,
  size = 32,
  label,
  tone = 'media',
  className,
}: ProgressRingProps) {
  const value = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
  const stroke = Math.max(3, Math.round(size / 11));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const arcStyle = {
    stroke: 'var(--color-brand)',
    '--ring-c': `${circumference}px`,
  } as CSSProperties;

  const ring = (
    <svg
      aria-hidden
      data-testid="progress-ring"
      data-percent={Math.round(value)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={label === undefined && className ? `block ${className}` : 'block'}
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        className={tone === 'page' ? 'stroke-bg-tertiary' : 'stroke-white/25'}
      />
      <circle
        data-testid="progress-ring-arc"
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - value / 100)}
        transform={`rotate(-90 ${center} ${center})`}
        className="animate-ring-draw motion-reduce:animate-none"
        style={arcStyle}
      />
    </svg>
  );

  if (label === undefined) return ring;

  return (
    <span
      aria-hidden
      data-testid="progress-ring-labelled"
      className={
        className ? `relative inline-block shrink-0 ${className}` : 'relative inline-block shrink-0'
      }
      style={{ width: size, height: size }}
    >
      {ring}
      <span
        data-testid="progress-ring-label"
        className="absolute inset-0 flex items-center justify-center text-xl font-extrabold tracking-tight text-text tabular-nums"
      >
        {label}
      </span>
    </span>
  );
}
