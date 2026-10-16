/**
 * The module band's progress ring (08.5-07, UI-D-429, UI-D-443, accent item P-08.5), ported from the
 * prototype's `ProgressRing` at its band size: 32px, the brand stroke (`var(--color-brand)`) on a
 * `white/25` track, the arc starting at twelve o'clock.
 *
 * **Decorative.** `aria-hidden`: the band's accessible name already carries "{percent}% concluído",
 * so the ring repeats nothing to a screen reader. **No animation** (UI-D-443): the prototype's 0.8 s
 * draw is dropped, so a server-rendered ring never sweeps from 0 on hydration, and `motion` is not
 * imported. Props only, no words.
 */
export interface ProgressRingProps {
  /** 0–100; clamped here so a stray value cannot overdraw the circle. */
  percent: number;
  /** Diameter in px; the band uses 32. */
  size?: number;
  className?: string;
}

export function ProgressRing({ percent, size = 32, className }: ProgressRingProps) {
  const value = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
  const stroke = Math.max(3, Math.round(size / 11));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  return (
    <svg
      aria-hidden
      data-testid="progress-ring"
      data-percent={Math.round(value)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className ? `block ${className}` : 'block'}
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        className="stroke-white/25"
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
        style={{ stroke: 'var(--color-brand)' }}
      />
    </svg>
  );
}
