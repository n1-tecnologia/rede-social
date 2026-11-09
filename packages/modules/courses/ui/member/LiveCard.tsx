'use client';

import { MediaImage } from '@rede-social/core/ui';
import { cn, SkinTileFx } from '@rede-social/ui';
import { ChevronRight, Play } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { LiveStatusChip } from './LiveStatusChip';
import { SCRIM_CARD, SCRIM_EVENT } from './recipes';

/**
 * The member's live card (08.5-06, UI-D-434, D-431, COURSE-23): ONE anchor with the host's
 * accessible name, a plain `<a>` (MOD-02), the status IN WORDS (the host's "Ao vivo agora",
 * "Agendada", "Gravada", "Cancelada") and the host's tag slot (the store's "Exclusiva") after it.
 *
 * **2026-10-22 (the courses area redesign on the social-igoralves prototype).** Three variants, one
 * per place a live is drawn:
 *
 *  - `tile` (the default; the prototype's `EventMiniCard`) — the 16:10 cover IS the card: the
 *    `SCRIM_EVENT` veil, the status chip and the tags at the top-left, the title 12/700 and the meta
 *    at the foot, white over the veil. The "Gravadas" grid;
 *  - `spotlight` (the prototype's `LiveSpotlight`) — the next live, large: the 16:10 cover (2:1 in
 *    the desktop column) with the 10px chip, the meta as the overline and the title 18/800; red
 *    hairline while on air;
 *  - `agenda` (the prototype's `LiveAgendaCard`) — no cover: the date column (the day 20/800 in the
 *    brand, the month 10px), the status as an overline, the title and the host's "{time} · {duration}
 *    min" line, a chevron. The rest of "Próximas".
 *
 * The on-air status is the red chip with the breathing dot (`LiveStatusChip`, CSS motion, still under
 * "reduzir movimento"); a replay leads with `Play`. A cancelled card keeps its colour; only its title
 * steps back (`text-white/70` over a cover, `text-text-secondary` on the ground) and the anchor says
 * `data-cancelled`. No cover, or one that fails to load, is the `--brand-gradient` in the SAME box.
 *
 * Props only and no words (PWA-03): the status label, the meta and the date parts (formatted on the
 * server in the tenant's timezone, UI-D-288), the tags and every name arrive from the host.
 *
 * **2026-10-26 (the member skin).** Every variant is the skin's interactive card (`ms-card`: ring,
 * sheen and lift); the tile and the spotlight zoom their art a little under the vignette and the
 * brand glows (`SkinTileFx`) and the spotlight's title grows into the skin's compact title; the
 * agenda row is a glass panel with the date on a brand tint and a chevron that steps forward. The
 * admin's lists draw the tile and the spotlight too: outside `[data-member-skin]` the hooks are
 * inert and they look as before.
 *
 * **2026-10-26 (the academy reference's card language, the member's Lives only).** A fourth
 * variant, `card`: the catalogue's course card for a live (a panel, the 16:9 cover on top with the
 * status chip and the tags, a play disc on hover; the title and the meta UNDER the art, never over
 * it). The member's "Gravadas" grid draws it; the admin keeps `tile`. And `wide`: the spotlight
 * alone across the row flattens to 3:1 from `lg` (the reference's banner).
 */
export interface LiveCardProps {
  /** Built by the HOST (`/cursos/lives/{id}`). */
  href: string;
  /** The link's accessible name, composed by the host. */
  ariaLabel: string;
  title: string;
  /** "{date}, {time} · {duration} min". */
  meta: string;
  /** The status in words. */
  statusLabel: string;
  /** `live` → the red chip with the breathing dot; `replay` → `Play` leads the chip. */
  statusIcon?: 'live' | 'replay' | null;
  /** Null takes the gradient branch (D-69). Unused by `agenda`. */
  coverAssetId: string | null;
  /** The variant ladder `MediaImage` builds its `srcSet` from (R-06). */
  coverWidths: readonly number[];
  /** The store's "Exclusiva", host-composed; follows the status. */
  tags?: ReactNode;
  /** A cancelled live: the title steps back; the cover stays in colour. */
  cancelled?: boolean;
  eager?: boolean;
  variant?: 'tile' | 'spotlight' | 'agenda' | 'card';
  /** `spotlight` alone across the row: 3:1 from `lg`. */
  wide?: boolean;
  /** `agenda`: the day ("24") and the short month ("out"), in the tenant's timezone. */
  day?: string;
  month?: string;
  /** `agenda`: "{time} · {duration} min"; the meta when absent. */
  timeLine?: string;
}

/**
 * The covers' widths (2026-10-23, the wide desktop): a tile is a half, a third (640px) or a quarter
 * (lg, up to ~300px) of the row; the spotlight is the column on a phone and up to ~740px beside the
 * agenda on a desktop.
 */
const TILE_SIZES = '(min-width: 1024px) 300px, (min-width: 640px) 33vw, 50vw';
const CARD_SIZES =
  '(min-width: 1280px) 300px, (min-width: 1024px) 33vw, (min-width: 480px) 50vw, 100vw';
const SPOTLIGHT_SIZES = '(min-width: 1024px) 740px, (min-width: 768px) calc(100vw - 320px), 100vw';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The status over the agenda's ground: the red chip on air, else an overline in words. */
function AgendaStatus({
  label,
  icon,
  cancelled,
}: {
  label: string;
  icon: 'live' | 'replay' | null;
  cancelled: boolean;
}) {
  if (icon === 'live')
    return <LiveStatusChip testId="live-card-status" label={label} icon="live" />;
  return (
    <span
      data-testid="live-card-status"
      className={cn(
        'min-w-0 truncate text-[10px] font-bold uppercase tracking-wider',
        cancelled ? 'text-text-tertiary' : 'text-brand',
      )}
    >
      {label}
    </span>
  );
}

export function LiveCard({
  href,
  ariaLabel,
  title,
  meta,
  statusLabel,
  statusIcon = null,
  coverAssetId,
  coverWidths,
  tags,
  cancelled = false,
  eager = false,
  variant = 'tile',
  wide = false,
  day,
  month,
  timeLine,
}: LiveCardProps) {
  // Keyed by asset id, so a different cover retries instead of inheriting a previous failure.
  const [failedId, setFailedId] = useState<string | null>(null);
  const showImage = coverAssetId !== null && failedId !== coverAssetId;

  if (variant === 'agenda') {
    return (
      <a
        href={href}
        aria-label={ariaLabel}
        data-testid="live-card"
        data-variant="agenda"
        data-cancelled={cancelled ? 'true' : undefined}
        className={cn(
          'ms-card ms-panel group flex min-h-[88px] items-stretch overflow-hidden rounded-xl border border-border bg-card transition-colors hover:bg-bg-hover',
          FOCUS,
        )}
      >
        <span
          aria-hidden
          data-testid="live-card-date"
          className="flex w-16 shrink-0 flex-col items-center justify-center bg-brand/[0.07]"
        >
          <span className="text-xl font-extrabold leading-none text-brand tabular-nums">{day}</span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-wider text-text-secondary">
            {month}
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col justify-center p-3">
          <span data-testid="live-card-pills" className="flex flex-wrap items-center gap-1">
            <AgendaStatus label={statusLabel} icon={statusIcon} cancelled={cancelled} />
            {tags}
          </span>
          <span
            data-testid="live-card-title"
            className={cn(
              'mt-0.5 line-clamp-2 break-words text-sm font-bold leading-snug',
              cancelled ? 'text-text-secondary' : 'text-text',
            )}
          >
            {title}
          </span>
          <span
            data-testid="live-card-meta"
            className="mt-1 text-xs font-normal text-text-tertiary tabular-nums"
          >
            {timeLine ?? meta}
          </span>
        </span>
        <span aria-hidden className="flex w-9 shrink-0 items-center justify-center">
          <ChevronRight
            size={16}
            className="text-text-tertiary transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        </span>
      </a>
    );
  }

  const spotlight = variant === 'spotlight';
  const art =
    showImage && coverAssetId !== null ? (
      <MediaImage
        assetId={coverAssetId}
        widths={coverWidths}
        alt=""
        sizes={spotlight ? SPOTLIGHT_SIZES : variant === 'card' ? CARD_SIZES : TILE_SIZES}
        eager={eager}
        ratio=""
        className="ms-zoom absolute inset-0 h-full w-full"
        onFailed={() => setFailedId(coverAssetId)}
      />
    ) : (
      <div
        aria-hidden
        data-testid="live-card-fallback"
        className="ms-zoom absolute inset-0"
        style={{ backgroundImage: 'var(--brand-gradient)' }}
      />
    );

  if (variant === 'card') {
    return (
      <a
        href={href}
        aria-label={ariaLabel}
        data-testid="live-card"
        data-variant="card"
        data-cancelled={cancelled ? 'true' : undefined}
        className={cn(
          'ms-card ms-panel ms-solid group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition-opacity active:opacity-90',
          FOCUS,
        )}
      >
        <div
          data-testid="live-card-cover"
          data-branch={showImage ? 'image' : 'gradient'}
          className="relative aspect-video overflow-hidden bg-bg-tertiary"
        >
          {art}
          <SkinTileFx soft />
          <span aria-hidden className={cn('absolute inset-0', SCRIM_CARD)} />
          <div
            data-testid="live-card-pills"
            className="absolute top-2.5 right-2.5 left-2.5 flex flex-wrap items-start gap-1"
          >
            <LiveStatusChip
              testId="live-card-status"
              label={statusLabel}
              icon={statusIcon}
              size="sm"
            />
            {tags}
          </div>
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 motion-reduce:transition-none"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/25">
              <Play size={16} fill="currentColor" className="ml-0.5" />
            </span>
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <p
            data-testid="live-card-title"
            className={cn(
              'ms-title-font line-clamp-2 break-words text-sm font-semibold leading-snug sm:text-[15px]',
              cancelled ? 'text-text-secondary' : 'text-text',
            )}
          >
            {title}
          </p>
          <p
            data-testid="live-card-meta"
            className="mt-auto text-xs font-normal text-text-tertiary tabular-nums"
          >
            {meta}
          </p>
        </div>
      </a>
    );
  }

  return (
    <a
      href={href}
      aria-label={ariaLabel}
      data-testid="live-card"
      data-variant={variant}
      data-cancelled={cancelled ? 'true' : undefined}
      className={cn(
        'ms-card group block overflow-hidden border bg-bg-tertiary transition-opacity active:opacity-90',
        spotlight ? 'rounded-2xl' : 'rounded-xl',
        spotlight && statusIcon === 'live' ? 'border-danger/40' : 'border-border',
        FOCUS,
      )}
    >
      <div
        data-testid="live-card-cover"
        data-branch={showImage ? 'image' : 'gradient'}
        className={cn(
          'relative aspect-[16/10]',
          spotlight && 'md:aspect-[2/1]',
          spotlight && wide && 'lg:aspect-[3/1] 2xl:aspect-[4/1]',
        )}
      >
        {art}
        <SkinTileFx soft={!spotlight} />
        <span
          aria-hidden
          className={cn(
            'absolute inset-0',
            spotlight ? 'bg-gradient-to-t from-black/85 via-black/25 to-transparent' : SCRIM_EVENT,
          )}
        />
        <div
          data-testid="live-card-pills"
          className={cn(
            'absolute flex flex-wrap items-start gap-1',
            spotlight ? 'top-3 right-3 left-3' : 'top-2 right-2 left-2',
          )}
        >
          <LiveStatusChip
            testId="live-card-status"
            label={statusLabel}
            icon={statusIcon}
            size={spotlight ? 'lg' : 'sm'}
          />
          {tags}
        </div>
        <div className={cn('absolute inset-x-0 bottom-0', spotlight ? 'px-4 pb-3.5' : 'p-2.5')}>
          {spotlight ? (
            <p
              data-testid="live-card-meta"
              className="text-[11px] font-bold uppercase tracking-wider text-white/80 tabular-nums [overflow-wrap:anywhere]"
            >
              {meta}
            </p>
          ) : null}
          <p
            data-testid="live-card-title"
            className={cn(
              'line-clamp-2 break-words leading-tight',
              spotlight
                ? 'ms-title-compact ms-title-tile ms-title-font mt-0.5 text-lg font-extrabold leading-snug'
                : 'text-xs font-bold',
              cancelled ? 'text-white/70' : 'text-white',
            )}
          >
            {title}
          </p>
          {spotlight ? null : (
            <p
              data-testid="live-card-meta"
              className="mt-0.5 truncate text-[10px] font-normal text-white/75 tabular-nums"
            >
              {meta}
            </p>
          )}
        </div>
      </div>
    </a>
  );
}
