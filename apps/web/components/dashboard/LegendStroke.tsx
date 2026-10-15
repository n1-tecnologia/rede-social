/** A legend swatch that repeats the line's own stroke, so the series differ by pattern, not colour. */
export function LegendStroke({ dashed }: { dashed: boolean }) {
  return (
    <svg aria-hidden width={24} height={8} className={dashed ? 'text-text-tertiary' : 'text-brand'}>
      <line
        x1={0}
        x2={24}
        y1={4}
        y2={4}
        stroke="currentColor"
        strokeWidth={dashed ? 2 : 2.5}
        {...(dashed ? { strokeDasharray: '5 5' } : {})}
      />
    </svg>
  );
}
