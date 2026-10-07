/**
 * The EXAMPLE ticket's QR (2026-10-06, the REINE prototype's `PseudoQr`): a QR-looking grid drawn
 * from the ticket code, stable per code, with the three finder squares. It is NOT a scannable code
 * (the system issues no tickets), so it is decorative and the screen tags it as an example.
 */
const SIZE = 25;
const FINDERS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [SIZE - 7, 0],
  [0, SIZE - 7],
];

function inFinder(x: number, y: number): boolean {
  return FINDERS.some(([fx, fy]) => x >= fx - 1 && x <= fx + 7 && y >= fy - 1 && y <= fy + 7);
}

/** A tiny deterministic generator (mulberry32) seeded by the code. */
function generator(code: string): () => number {
  let seed = 0;
  for (const char of code) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function PseudoQr({ code, size = 168 }: { code: string; size?: number }) {
  const next = generator(code);
  const modules: Array<[number, number]> = [];
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (!inFinder(x, y) && next() > 0.52) modules.push([x, y]);
    }
  }
  return (
    <svg
      aria-hidden
      data-pseudo-qr=""
      width={size}
      height={size}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      shapeRendering="crispEdges"
    >
      {FINDERS.map(([fx, fy]) => (
        <g key={`${fx}-${fy}`} fill="currentColor">
          <path fillRule="evenodd" d={`M${fx} ${fy}h7v7h-7z M${fx + 1} ${fy + 1}v5h5v-5z`} />
          <rect x={fx + 2} y={fy + 2} width={3} height={3} />
        </g>
      ))}
      {modules.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />
      ))}
    </svg>
  );
}
