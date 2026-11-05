import { MediaImage } from '@rede-social/core/ui';
import { cn } from '@rede-social/ui';
import { ArrowUpRight, BookOpen } from 'lucide-react';
import type { CSSProperties } from 'react';
import { SCRIM_TRACK_CARD, SCRIM_TRACK_TILE, TRACK_LINE_SHADOW } from './recipes';

/**
 * A track as the academy reference draws it (2026-10-26, Início's and Trilhas' cards; the product
 * owner: "o modelo de card igual"). The track cover IS the card, on a black ground, ONE anchor.
 *
 *  - `lg` (the big card, the reference's "Create · Agents · Build"): the art at 80% under two glows
 *    of the brand that breathe out of step (`ms-track-glow`, `ms-track-glow-alt`, 10.5s; still under
 *    "reduzir movimento"), a veil dark at the top and a dot texture; the eyebrow with a book glyph
 *    ("Sua trilha · 3 cursos"), the title large and thin (3 lines kept), and from `lg` the host's line
 *    (where the member stands) appearing on hover; at the foot the "Acesse ↗" glass chip, the share
 *    and a 2px band, always drawn. 3:4 on a phone, 300px tall from `sm`, about a third of the screen
 *    from `lg` (280 to 420px). The art zooms slowly on hover (1.04 over 0.7s).
 *  - `sm` (the reference's stacked tiles): the art dimmed and desaturated, a vignette and a veil at
 *    the foot, the title and a dotted line with the eyebrow at the bottom-left; the art grows on hover.
 *
 * 2026-10-27 (`lg`): the manager's subtitle under the title ("o subtítulo deve aparecer aqui em baixo
 * nesse card") and the audience as a small tag beside "Acesse", in its glass ("o para quem é deve
 * ser uma tag aqui pequena igual ao acesse"); each only when the host passes it.
 *
 * `index` varies the glows' corner and phase card to card, as the reference does. Props only, no
 * words (PWA-03, MOD-02): the eyebrow, the chip's word, the line and the accessible name come from
 * the host; the share is a number and a sign.
 */
export interface MemberTrackCardProps {
  href: string;
  ariaLabel: string;
  title: string;
  /** "Sua trilha · 3 cursos". */
  eyebrow: string;
  /** The chip's word ("Acesse"); `lg` only. */
  cta: string;
  /** 0–100 once started; null keeps the band empty and draws no share. */
  percent: number | null;
  /** Under the title from `lg`, on hover: where the member stands. */
  line?: string | null;
  /** 2026-10-27, `lg`: the track's subtitle, under the title. */
  subtitle?: string | null;
  /** 2026-10-27, `lg`: the audience ("Para quem está começando"), a tag beside the chip. */
  tag?: string | null;
  coverAssetId: string | null;
  coverWidths: readonly number[];
  size?: 'lg' | 'sm';
  /** The card's place in its row: the glows' corner and phase. */
  index?: number;
  eager?: boolean;
  className?: string;
  /** The `data-track-id` value. */
  id: string;
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The "Acesse ↗" chip's glass, and the audience tag beside it (2026-10-27). */
const CHIP =
  'inline-flex items-center rounded-full border border-white/20 bg-white/[0.05] px-3 py-1 text-[11px] font-medium text-white/80 backdrop-blur-sm transition-colors duration-300 group-hover:border-white/35 group-hover:text-white';

/** The glows alternate corners and start 2.6s apart, card to card. */
function glowStyle(index: number): CSSProperties {
  const odd = index % 2 === 1;
  return {
    '--ms-glow-x': odd ? '85%' : '15%',
    '--ms-glow-alt-x': odd ? '12%' : '88%',
    '--ms-glow-delay': `${-2.6 * index}s`,
  } as CSSProperties;
}

function Art({
  coverAssetId,
  coverWidths,
  sizes,
  eager,
  className,
}: {
  coverAssetId: string | null;
  coverWidths: readonly number[];
  sizes: string;
  eager: boolean;
  className: string;
}) {
  const gradient = (
    <span
      data-testid="member-track-card-fallback"
      className={cn('absolute inset-0 block', className)}
      style={{ backgroundImage: 'var(--brand-gradient)' }}
    />
  );
  if (!coverAssetId) return gradient;
  return (
    <MediaImage
      assetId={coverAssetId}
      widths={coverWidths}
      alt=""
      sizes={sizes}
      eager={eager}
      ratio=""
      className={cn('absolute inset-0 h-full w-full', className)}
      fallback={gradient}
    />
  );
}

export function MemberTrackCard({
  href,
  ariaLabel,
  title,
  eyebrow,
  cta,
  percent,
  line,
  subtitle,
  tag,
  coverAssetId,
  coverWidths,
  size = 'lg',
  index = 0,
  eager = false,
  className,
  id,
}: MemberTrackCardProps) {
  const share =
    percent === null
      ? null
      : Math.min(100, Math.max(0, Math.round(Number.isFinite(percent) ? percent : 0)));

  if (size === 'sm') {
    return (
      <a
        href={href}
        aria-label={ariaLabel}
        data-testid="member-track-card"
        data-track-id={id}
        data-size="sm"
        className={cn(
          'ms-card group relative block h-full min-h-[7.5rem] overflow-hidden rounded-2xl border border-white/[0.05] bg-black text-white transition-opacity active:opacity-90',
          FOCUS,
          className,
        )}
      >
        <span aria-hidden className="absolute inset-0 block overflow-hidden rounded-[inherit]">
          <Art
            coverAssetId={coverAssetId}
            coverWidths={coverWidths}
            sizes="(min-width: 1024px) 260px, 45vw"
            eager={eager}
            className="scale-[1.15] opacity-60 brightness-90 saturate-[0.6] transition-[opacity,scale] duration-700 ease-out sm:scale-[1.24] lg:group-hover:scale-[1.28] lg:group-hover:opacity-75 motion-reduce:transition-none"
          />
          <span className={cn('absolute inset-0 block', SCRIM_TRACK_TILE)} />
          <span className="absolute inset-x-0 bottom-0 block h-1/2 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
        </span>
        <span className="absolute inset-x-3 bottom-3 z-10 flex min-w-0 flex-col lg:inset-x-4 lg:bottom-3.5">
          <span
            data-testid="member-track-card-title"
            className="ms-title-font line-clamp-2 break-words text-[13px] font-medium leading-tight tracking-tight text-white/80 sm:text-[15px] lg:text-base"
          >
            {title}
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.12em] text-white/70 sm:text-[10px]">
            <span
              aria-hidden
              className="h-1 w-1 shrink-0 rounded-full bg-brand ring-2 ring-brand/15"
            />
            <span className="min-w-0 truncate">{eyebrow}</span>
          </span>
        </span>
      </a>
    );
  }

  return (
    <a
      href={href}
      aria-label={ariaLabel}
      data-testid="member-track-card"
      data-track-id={id}
      data-size="lg"
      style={glowStyle(index)}
      className={cn(
        'ms-card group relative flex aspect-[3/4] flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.07] bg-black p-4 text-white transition-opacity active:opacity-90 sm:aspect-auto sm:h-[300px] sm:p-5 lg:h-[clamp(280px,calc(var(--screen-h)*0.36),420px)] lg:p-6',
        FOCUS,
        className,
      )}
    >
      <span aria-hidden className="absolute inset-0 block overflow-hidden rounded-[inherit]">
        <Art
          coverAssetId={coverAssetId}
          coverWidths={coverWidths}
          sizes="(min-width: 1024px) 480px, 50vw"
          eager={eager}
          className="opacity-80 transition-[scale] duration-700 ease-out group-hover:scale-[1.04] motion-reduce:transition-none"
        />
        <span className="ms-track-glow hidden" />
        <span className="ms-track-glow-alt hidden" />
        <span className={cn('absolute inset-0 block', SCRIM_TRACK_CARD)} />
        <span className="ms-dots hidden" />
      </span>

      <span className="relative z-10 flex min-w-0 flex-col">
        <span className="mb-1.5 flex min-w-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/50">
          <BookOpen aria-hidden size={12} className="shrink-0" />
          <span className="min-w-0 truncate">{eyebrow}</span>
        </span>
        <span
          data-testid="member-track-card-title"
          className="ms-title-font line-clamp-3 break-words text-lg font-medium leading-tight tracking-tight text-white/[0.97] md:text-2xl lg:text-[28px] xl:text-[32px]"
        >
          {title}
        </span>
        {subtitle ? (
          <span
            data-testid="member-track-card-subtitle"
            className={cn(
              'mt-2 line-clamp-2 break-words text-[13px] leading-snug text-white/75 sm:text-sm',
              TRACK_LINE_SHADOW,
            )}
          >
            {subtitle}
          </span>
        ) : null}
        {line ? (
          <span
            data-testid="member-track-card-line"
            className={cn(
              'pointer-events-none mt-3 hidden text-[13px] leading-relaxed text-white/85 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none lg:block',
              TRACK_LINE_SHADOW,
            )}
          >
            {line}
          </span>
        ) : null}
      </span>

      <span className="relative z-10 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className={cn(CHIP, 'shrink-0 gap-1')}>
            {cta}
            <ArrowUpRight size={12} className="shrink-0" />
          </span>
          {tag ? (
            <span data-testid="member-track-card-tag" className={cn(CHIP, 'min-w-0')}>
              <span className="truncate">{tag}</span>
            </span>
          ) : null}
        </span>
        {share !== null ? (
          <span
            aria-hidden
            data-testid="member-track-card-percent"
            className="text-[11px] font-medium tracking-wide text-white/45 tabular-nums"
          >
            {`${share}%`}
          </span>
        ) : null}
      </span>

      <span aria-hidden className="absolute inset-x-0 bottom-0 block h-[2px] bg-white/[0.06]">
        <span
          className="block h-full bg-brand/70 transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${share ?? 0}%` }}
        />
      </span>
    </a>
  );
}
