import type { CSSProperties, ReactNode } from 'react';

/**
 * Mockup illustrations for the preview's sample media, in place of the brand gradient a cover or a
 * post without media would show: the style of the NOZ community posts (flat shapes, a soft floor
 * shadow), redrawn so the accents are the TENANT's colours and the rest is white and gray.
 *
 * Colours are CSS (`style`), never presentation attributes: `var()` resolves in `style` everywhere.
 * The accents read the screen's `--brand-primary` / `--brand-secondary`, so they follow the form
 * live; the neutrals are mixed from white and black, so the picture keeps its light "photo" look in
 * both themes. No gradient and no `<defs>`: nothing here needs an id, so the scenes repeat freely.
 */

export type PreviewArtScene = 'welcome' | 'stage' | 'call' | 'board' | 'meetup';

const BRAND = 'var(--brand-primary)';
const SECOND = 'var(--brand-secondary)';
const DEEP = 'color-mix(in oklch, var(--brand-primary) 70%, black)';
const SOFT = 'color-mix(in oklch, var(--brand-primary) 35%, white)';
const TINT = 'color-mix(in oklch, var(--brand-primary) 13%, white)';
const TINT_2 = 'color-mix(in oklch, var(--brand-secondary) 22%, white)';
const WHITE = 'white';
const PAPER = 'color-mix(in oklch, white, black 3%)';
const GRAY_1 = 'color-mix(in oklch, white, black 8%)';
const GRAY_2 = 'color-mix(in oklch, white, black 15%)';
const GRAY_3 = 'color-mix(in oklch, white, black 28%)';
const INK_2 = 'color-mix(in oklch, white, black 55%)';
const INK = 'color-mix(in oklch, white, black 72%)';

const fill = (color: string): CSSProperties => ({ fill: color });
const line = (color: string): CSSProperties => ({ fill: 'none', stroke: color });
const SHADOW: CSSProperties = { fill: 'black', opacity: 0.08 };

/** A heart in a 10 × 9 box, placed and scaled by the caller. */
function Heart({ x, y, size, color }: { x: number; y: number; size: number; color: string }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${size / 10})`}
      d="M5 8.6C2.2 6.6.3 4.9.3 2.9.3 1.4 1.5.3 2.9.3c.9 0 1.7.5 2.1 1.3C5.4.8 6.2.3 7.1.3c1.4 0 2.6 1.1 2.6 2.6 0 2-1.9 3.7-4.7 5.7Z"
      style={fill(color)}
    />
  );
}

/** A speech bubble with three dots (its tail points down-left). */
function Bubble({
  x,
  y,
  w,
  h,
  ground,
  dots,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  ground: string;
  dots: string;
}) {
  const cy = y + h / 2;
  const step = w / 4;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={h / 2.6} style={fill(ground)} />
      <path d={`M${x + 4} ${y + h - 0.5} l-2.5 4.2 l6 -4.2 Z`} style={fill(ground)} />
      {[1, 2, 3].map((i) => (
        <circle key={i} cx={x + step * i} cy={cy} r={h / 9} style={fill(dots)} />
      ))}
    </g>
  );
}

/** A head-and-shoulders silhouette, its feet on `y`. */
function Person({ x, y, size, color }: { x: number; y: number; size: number; color: string }) {
  return (
    <g>
      <circle cx={x} cy={y - size * 1.55} r={size * 0.62} style={fill(color)} />
      <rect
        x={x - size}
        y={y - size * 0.82}
        width={size * 2}
        height={size * 0.82}
        rx={size * 0.4}
        style={fill(color)}
      />
    </g>
  );
}

/** Post "Boas-vindas" (4:5): the tenant's app on a phone, a like badge, a chat bubble, confetti. */
function Welcome() {
  return (
    <>
      <rect width="100" height="125" style={fill(TINT)} />
      <rect y="100" width="100" height="25" style={fill(PAPER)} />
      <rect
        x="13"
        y="15"
        width="6"
        height="2.6"
        rx="1.3"
        transform="rotate(-25 16 16.3)"
        style={fill(BRAND)}
      />
      <circle cx="85" cy="18" r="2.2" style={fill(SECOND)} />
      <rect
        x="80"
        y="44"
        width="5.4"
        height="2.4"
        rx="1.2"
        transform="rotate(30 82.7 45.2)"
        style={fill(GRAY_3)}
      />
      <circle cx="19" cy="40" r="1.6" style={fill(GRAY_3)} />
      <rect
        x="85"
        y="76"
        width="5"
        height="2.4"
        rx="1.2"
        transform="rotate(-40 87.5 77.2)"
        style={fill(BRAND)}
      />
      <circle cx="12" cy="86" r="2" style={fill(SECOND)} />
      <ellipse cx="50" cy="107" rx="25" ry="3" style={SHADOW} />
      {/* phone */}
      <rect x="30" y="20" width="40" height="85" rx="7" style={fill(INK)} />
      <rect x="32.5" y="23" width="35" height="79" rx="5" style={fill(WHITE)} />
      <rect x="44" y="25.2" width="12" height="3" rx="1.5" style={fill(INK)} />
      <rect x="32.5" y="30.5" width="35" height="9.5" style={fill(BRAND)} />
      <circle cx="37.6" cy="35.2" r="2.3" style={fill(WHITE)} />
      <rect x="42" y="34.2" width="14" height="2" rx="1" style={fill(WHITE)} />
      <circle cx="38.2" cy="46.5" r="3.6" strokeWidth="0.9" style={line(BRAND)} />
      <circle cx="38.2" cy="46.5" r="2.5" style={fill(SOFT)} />
      <circle cx="47.2" cy="46.5" r="3" style={fill(GRAY_1)} />
      <circle cx="56.2" cy="46.5" r="3" style={fill(GRAY_1)} />
      <rect
        x="35.5"
        y="53.5"
        width="29"
        height="32"
        rx="2.5"
        strokeWidth="0.6"
        style={{ fill: WHITE, stroke: GRAY_2 }}
      />
      <rect x="36.6" y="54.6" width="26.8" height="17.4" rx="1.8" style={fill(TINT_2)} />
      <circle cx="57.2" cy="59.4" r="2.3" style={fill(WHITE)} />
      <path d="M37.6 71 L45 62.8 L50 67.8 L54 64.4 L62.4 71 Z" style={fill(SECOND)} />
      <rect x="37.4" y="75" width="18" height="1.8" rx="0.9" style={fill(GRAY_2)} />
      <rect x="37.4" y="79" width="12" height="1.8" rx="0.9" style={fill(GRAY_1)} />
      <Heart x={57.4} y={76.6} size={4.4} color={BRAND} />
      <rect x="35.5" y="91.5" width="29" height="6.5" rx="3.25" style={fill(GRAY_1)} />
      <circle cx="41" cy="94.75" r="1.5" style={fill(BRAND)} />
      <circle cx="47" cy="94.75" r="1.15" style={fill(GRAY_3)} />
      <circle cx="53" cy="94.75" r="1.15" style={fill(GRAY_3)} />
      <circle cx="59" cy="94.75" r="1.15" style={fill(GRAY_3)} />
      {/* like badge and a reply */}
      <circle cx="72.5" cy="31" r="7.5" style={fill(BRAND)} />
      <Heart x={68.1} y={27.2} size={8.8} color={WHITE} />
      <Bubble x={9} y={56} w={19} h={10} ground={WHITE} dots={GRAY_3} />
    </>
  );
}

/** Event "Encontro de boas-vindas" (4:5): a stage with the brand banner, a podium, the audience. */
function Stage() {
  return (
    <>
      <rect width="100" height="125" style={fill(PAPER)} />
      <rect width="100" height="62" style={fill(TINT)} />
      <path d="M6 0 L30 62 L44 62 Z" style={{ fill: WHITE, opacity: 0.5 }} />
      <path d="M94 0 L70 62 L56 62 Z" style={{ fill: WHITE, opacity: 0.5 }} />
      <rect
        x="20"
        y="12"
        width="60"
        height="34"
        rx="2.5"
        strokeWidth="0.8"
        style={{ fill: WHITE, stroke: GRAY_2 }}
      />
      <rect x="20" y="12" width="60" height="6" rx="2.5" style={fill(BRAND)} />
      <rect x="20" y="15" width="60" height="3" style={fill(BRAND)} />
      <circle cx="36" cy="31.5" r="7" style={fill(BRAND)} />
      <circle cx="36" cy="31.5" r="3" style={fill(WHITE)} />
      <rect x="47" y="26.5" width="25" height="3" rx="1.5" style={fill(GRAY_3)} />
      <rect x="47" y="32.5" width="18" height="2.4" rx="1.2" style={fill(GRAY_2)} />
      <rect x="47" y="37.5" width="21" height="2.4" rx="1.2" style={fill(GRAY_1)} />
      <rect x="0" y="62" width="100" height="9" style={fill(BRAND)} />
      <rect x="0" y="70" width="100" height="3" style={fill(DEEP)} />
      <rect
        x="43.5"
        y="49"
        width="13"
        height="13.5"
        rx="1.5"
        strokeWidth="0.7"
        style={{ fill: WHITE, stroke: GRAY_2 }}
      />
      <rect x="42.5" y="47.6" width="15" height="3" rx="1.2" style={fill(INK_2)} />
      <rect x="47.5" y="53.5" width="5" height="5" rx="1" style={fill(BRAND)} />
      <path d="M54 47.6 L56.4 43.2" strokeWidth="0.8" style={line(INK)} />
      <circle cx="56.7" cy="42.6" r="1.1" style={fill(INK)} />
      <rect y="73" width="100" height="52" style={fill(GRAY_1)} />
      {[10, 26, 42, 58, 74, 90].map((x) => (
        <Person key={`a${x}`} x={x} y={92} size={4.2} color={GRAY_2} />
      ))}
      {[18, 34, 50, 66, 82].map((x) => (
        <Person key={`b${x}`} x={x} y={108} size={5.2} color={x === 50 ? SOFT : GRAY_3} />
      ))}
      {[8, 28, 48, 68, 88].map((x) => (
        <Person key={`c${x}`} x={x} y={126} size={6.4} color={x === 68 ? BRAND : INK_2} />
      ))}
    </>
  );
}

/** Event "Oficina prática", online (4:5): a laptop on a video call, a mug, a plant. */
function Call() {
  const tile = (x: number, y: number, ground: string, person: string, key: string) => (
    <g key={key}>
      <rect x={x} y={y} width="26.5" height="16.5" rx="1.5" style={fill(ground)} />
      <Person x={x + 13.25} y={y + 16.5} size={4.6} color={person} />
    </g>
  );
  return (
    <>
      <rect width="100" height="125" style={fill(TINT_2)} />
      <rect y="88" width="100" height="37" style={fill(PAPER)} />
      <rect y="88" width="100" height="1.6" style={fill(GRAY_1)} />
      <rect x="13" y="16" width="17" height="7" rx="3.5" style={fill(BRAND)} />
      <circle cx="17" cy="19.5" r="1.3" style={fill(WHITE)} />
      <rect x="19.6" y="18.6" width="7.4" height="1.8" rx="0.9" style={fill(WHITE)} />
      <Bubble x={67} y={14} w={21} h={11} ground={WHITE} dots={GRAY_3} />
      <ellipse cx="50" cy="91" rx="42" ry="2.6" style={SHADOW} />
      <rect x="17" y="32" width="66" height="46" rx="3.5" style={fill(INK)} />
      <rect x="20" y="35" width="60" height="40" rx="2" style={fill(WHITE)} />
      {tile(22, 37, BRAND, WHITE, 'host')}
      {tile(51.5, 37, GRAY_1, GRAY_3, 'b')}
      {tile(22, 56.5, GRAY_1, GRAY_3, 'c')}
      <rect x="51.5" y="56.5" width="26.5" height="16.5" rx="1.5" style={fill(GRAY_1)} />
      <rect x="55" y="59.5" width="19.5" height="10.5" rx="1" style={fill(WHITE)} />
      <rect x="55" y="59.5" width="19.5" height="3" rx="1" style={fill(SECOND)} />
      <rect x="57" y="64.6" width="11" height="1.6" rx="0.8" style={fill(GRAY_2)} />
      <rect x="57" y="67.4" width="7" height="1.6" rx="0.8" style={fill(GRAY_2)} />
      <path d="M9 78 h82 l5 8 h-92 Z" style={fill(GRAY_2)} />
      <path d="M9 78 h82 l1.4 2 h-84.8 Z" style={{ fill: WHITE, opacity: 0.6 }} />
      <rect
        x="6"
        y="79"
        width="9"
        height="9"
        rx="2"
        strokeWidth="0.6"
        style={{ fill: WHITE, stroke: GRAY_2 }}
      />
      <rect x="6" y="81.6" width="9" height="2.4" style={fill(BRAND)} />
      <path d="M15 80.6 a2.6 2.6 0 0 1 0 5.2" strokeWidth="1.2" style={line(GRAY_3)} />
      <path d="M87 79 C84 72 80.5 70 78.5 66 C83.5 67 86.4 71 87.4 79 Z" style={fill(SECOND)} />
      <path
        d="M88.4 79 C90.4 72.5 94 70.4 96 67.4 C95.6 72.5 92.2 76 89.4 79 Z"
        style={fill(SOFT)}
      />
      <path d="M83 79 h10 l-1.6 9 h-6.8 Z" style={fill(BRAND)} />
    </>
  );
}

/** Community "Avisos" (16:7): a pin board of notes, a megaphone, an alert badge. */
function Board() {
  return (
    <>
      <rect width="160" height="70" style={fill(TINT)} />
      <rect y="57" width="160" height="13" style={fill(PAPER)} />
      <rect
        x="44"
        y="7"
        width="76"
        height="46"
        rx="3"
        strokeWidth="1"
        style={{ fill: WHITE, stroke: GRAY_2 }}
      />
      <rect x="47" y="10" width="70" height="40" rx="2" style={fill(GRAY_1)} />
      <g transform="rotate(-4 62 29)">
        <rect x="51" y="15" width="22" height="27" rx="1.5" style={fill(WHITE)} />
        <rect x="54" y="22" width="15" height="1.8" rx="0.9" style={fill(GRAY_3)} />
        <rect x="54" y="26.5" width="13" height="1.6" rx="0.8" style={fill(GRAY_2)} />
        <rect x="54" y="30.5" width="15" height="1.6" rx="0.8" style={fill(GRAY_2)} />
        <rect x="54" y="34.5" width="9" height="1.6" rx="0.8" style={fill(GRAY_2)} />
      </g>
      <circle cx="62" cy="15.6" r="1.8" style={fill(BRAND)} />
      <g transform="rotate(3 86 27)">
        <rect x="76" y="14" width="20" height="23" rx="1.5" style={fill(SOFT)} />
        <rect x="79" y="21" width="13" height="1.8" rx="0.9" style={fill(WHITE)} />
        <rect x="79" y="25.5" width="10" height="1.6" rx="0.8" style={fill(WHITE)} />
        <rect x="79" y="29.5" width="12" height="1.6" rx="0.8" style={fill(WHITE)} />
      </g>
      <circle cx="86" cy="15" r="1.8" style={fill(SECOND)} />
      <g transform="rotate(-2 107 30)">
        <rect x="99" y="20" width="15" height="19" rx="1.5" style={fill(WHITE)} />
        <rect x="101.5" y="26" width="10" height="1.6" rx="0.8" style={fill(GRAY_2)} />
        <rect x="101.5" y="30" width="8" height="1.6" rx="0.8" style={fill(GRAY_2)} />
      </g>
      <circle cx="106.6" cy="20.6" r="1.6" style={fill(INK_2)} />
      <ellipse cx="25" cy="58" rx="16" ry="2" style={SHADOW} />
      <path d="M14 27 L31 19 L31 45 L14 37 Z" style={fill(BRAND)} />
      <rect x="9" y="26" width="6" height="12" rx="2" style={fill(DEEP)} />
      <rect x="31" y="17" width="3.4" height="30" rx="1.7" style={fill(WHITE)} />
      <path d="M18 37.5 L20 47 L24 47 L23 38.8 Z" style={fill(INK_2)} />
      <path d="M38 25.5 q5 6.5 0 13" strokeWidth="2" strokeLinecap="round" style={line(BRAND)} />
      <path d="M42.5 21 q8.5 11 0 22" strokeWidth="2" strokeLinecap="round" style={line(SOFT)} />
      <circle cx="137" cy="21" r="8" style={fill(SECOND)} />
      <rect x="135.9" y="15.6" width="2.2" height="7.4" rx="1.1" style={fill(WHITE)} />
      <circle cx="137" cy="26.2" r="1.25" style={fill(WHITE)} />
    </>
  );
}

/** Community "Encontros" (16:7): a calendar with a day in the brand, two chats, two coffees. */
function Meetup() {
  const days: ReactNode[] = [];
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const color = row === 2 && col === 2 ? BRAND : row === 1 && col === 3 ? SOFT : GRAY_1;
      days.push(
        <rect
          key={`${row}-${col}`}
          x={62.4 + col * 7.4}
          y={23 + row * 6.1}
          width="5.4"
          height="4.2"
          rx="1"
          style={fill(color)}
        />,
      );
    }
  }
  return (
    <>
      <rect width="160" height="70" style={fill(TINT_2)} />
      <rect y="55" width="160" height="15" style={fill(PAPER)} />
      <ellipse cx="80" cy="56" rx="26" ry="2" style={SHADOW} />
      <rect
        x="58"
        y="8"
        width="44"
        height="44"
        rx="3.5"
        strokeWidth="0.8"
        style={{ fill: WHITE, stroke: GRAY_2 }}
      />
      <rect x="58" y="8" width="44" height="10" rx="3.5" style={fill(BRAND)} />
      <rect x="58" y="13" width="44" height="5" style={fill(BRAND)} />
      <rect x="66" y="5" width="2.6" height="7" rx="1.3" style={fill(INK_2)} />
      <rect x="91.4" y="5" width="2.6" height="7" rx="1.3" style={fill(INK_2)} />
      {days}
      <Bubble x={20} y={12} w={27} h={14} ground={WHITE} dots={GRAY_3} />
      <Bubble x={112} y={20} w={25} h={13} ground={BRAND} dots={WHITE} />
      <ellipse cx="36" cy="56.5" rx="9" ry="1.4" style={SHADOW} />
      <rect
        x="30"
        y="43"
        width="12"
        height="13"
        rx="2.5"
        strokeWidth="0.6"
        style={{ fill: WHITE, stroke: GRAY_2 }}
      />
      <rect x="30" y="46.5" width="12" height="3" style={fill(SECOND)} />
      <path d="M42 45.4 a3 3 0 0 1 0 6" strokeWidth="1.3" style={line(GRAY_3)} />
      <path
        d="M34 40.5 q-1.6 -2.4 0 -4.8 M38 40.5 q-1.6 -2.4 0 -4.8"
        strokeWidth="0.9"
        strokeLinecap="round"
        style={line(GRAY_3)}
      />
      <ellipse cx="124" cy="56.5" rx="8" ry="1.3" style={SHADOW} />
      <rect
        x="118.5"
        y="45"
        width="11"
        height="11"
        rx="2.5"
        strokeWidth="0.6"
        style={{ fill: WHITE, stroke: GRAY_2 }}
      />
      <rect x="118.5" y="48" width="11" height="2.6" style={fill(BRAND)} />
      <path d="M129.5 47.4 a2.6 2.6 0 0 1 0 5.2" strokeWidth="1.2" style={line(GRAY_3)} />
    </>
  );
}

const SCENES: Record<PreviewArtScene, { box: string; draw: () => ReactNode }> = {
  welcome: { box: '0 0 100 125', draw: Welcome },
  stage: { box: '0 0 100 125', draw: Stage },
  call: { box: '0 0 100 125', draw: Call },
  board: { box: '0 0 160 70', draw: Board },
  meetup: { box: '0 0 160 70', draw: Meetup },
};

/**
 * One scene filling its (positioned) box, cropped like a photo (`slice`): the 4:5 scenes fill the
 * post, the posters and the next-event thumb; the 16:7 ones the community cards.
 */
export function PreviewArt({ scene }: { scene: PreviewArtScene }) {
  const { box, draw: Draw } = SCENES[scene];
  return (
    <svg
      aria-hidden
      viewBox={box}
      preserveAspectRatio="xMidYMid slice"
      data-preview-art={scene}
      className="absolute inset-0 h-full w-full"
    >
      <Draw />
    </svg>
  );
}
