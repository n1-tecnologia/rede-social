'use client';

import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { LiveCard, LiveStatusChip } from '@rede-social/module-courses/ui';
import { cn, Skeleton } from '@rede-social/ui';
import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CourseRowView, LiveCardFields } from '@/lib/courses-view';

/**
 * 2026-10-23 — the admin's live cards (the Lives screen in the social-igoralves panel's design): the
 * member's showcase cards, each with its own "Editar" door to the live's form.
 *
 *  - `spotlight` and `tile` are the courses module's `LiveCard` as the member sees it; the door is a
 *    glass "Editar" in the cover's top-right corner, the status chip's mirror;
 *  - `agenda` is drawn here, in the module card's geometry (the date column, the status overline or
 *    the red on-air chip, the title, "{time} · {duration} min"), because the module's agenda card is
 *    ONE anchor; the door is the brand-tinted "Editar" at the row's right end, where the chevron was.
 *
 * The card and the door are SIBLING links, never an `<a>` inside an `<a>`. The card keeps the row's
 * accessible name ("{title}, {status}") and its route; the door is named "Editar a live: {title}"
 * and keeps a 44px hit area around its smaller pill. Every word arrives finished (`liveRowView`): the
 * status in words, the tenant-time date parts, the names. Nothing here formats or reads the clock.
 *
 * 2026-10-23 (the wide desktop lists): the "Passadas" grid gains a fourth column from `xl`; the
 * upcoming layout (spotlight beside the agenda from `lg`) is `UPCOMING_LIVES_GRID` in `admin-styles`.
 */
export type AdminLiveCardVariant = 'spotlight' | 'agenda' | 'tile';

const FOCUS_INSET =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand';

/** The door's focus ring sits on its pill, not on the larger hit area around it. */
const PILL_FOCUS =
  'group-focus-visible:ring-2 group-focus-visible:ring-brand group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-bg';

/** Over a cover: black alpha like the area's glass chips, so it holds on any art and in both themes. */
const GLASS_EDIT =
  'inline-flex items-center gap-1 rounded-full bg-black/55 font-bold text-white backdrop-blur-sm transition-opacity group-active:opacity-80';

/** On the page's ground (the agenda rows): the brand's tint, never its fill (one brand fill a screen). */
const TINT_EDIT =
  'inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-1.5 text-[11px] font-bold text-brand transition-opacity group-active:opacity-80';

/** The "Gravadas" grid's geometry: two columns, three from 640px, four from `xl` (2026-10-23). */
export const ADMIN_LIVES_GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4';

/**
 * The glass door over a cover, in the corner opposite the status chip and at its inset (12px on the
 * spotlight, 8px on a tile), so the two sit level.
 */
function CoverEditDoor({
  href,
  ariaLabel,
  spotlight,
}: {
  href: string;
  ariaLabel: string;
  spotlight: boolean;
}) {
  const t = useTranslations('courses');
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      data-testid="live-edit"
      className={cn(
        'group absolute top-0 right-0 flex min-h-11 min-w-11 items-start justify-end rounded-full focus-visible:outline-none',
        spotlight ? 'p-3' : 'p-2',
      )}
    >
      <span
        className={cn(
          GLASS_EDIT,
          PILL_FOCUS,
          spotlight ? 'px-2.5 py-1.5 text-[11px]' : 'px-2 py-1 text-[10px]',
        )}
      >
        <Pencil aria-hidden size={spotlight ? 11 : 10} className="shrink-0" />
        {t('lives.edit')}
      </span>
    </a>
  );
}

/** The agenda's status: the red chip on air, else the overline in words (brand, or quiet when cancelled). */
function AgendaStatus({ card }: { card: LiveCardFields }) {
  if (card.statusIcon === 'live') {
    return <LiveStatusChip testId="live-card-status" label={card.statusLabel} icon="live" />;
  }
  return (
    <span
      data-testid="live-card-status"
      className={cn(
        'min-w-0 truncate text-[10px] font-bold uppercase tracking-wider',
        card.cancelled ? 'text-text-tertiary' : 'text-brand',
      )}
    >
      {card.statusLabel}
    </span>
  );
}

/** One agenda row: the card link (date, status, title, time) and the "Editar" door beside it. */
function AgendaRow({ item, card }: { item: CourseRowView; card: LiveCardFields }) {
  const t = useTranslations('courses');
  return (
    <div className="flex min-h-[88px] items-stretch overflow-hidden rounded-xl border border-border bg-card">
      <a
        href={item.href}
        aria-label={item.ariaLabel}
        data-testid="live-card"
        data-variant="agenda"
        data-cancelled={card.cancelled ? 'true' : undefined}
        className={cn(
          'flex min-w-0 flex-1 items-stretch transition-colors hover:bg-bg-hover',
          FOCUS_INSET,
        )}
      >
        <span
          aria-hidden
          data-testid="live-card-date"
          className="flex w-16 shrink-0 flex-col items-center justify-center bg-bg-tertiary"
        >
          <span className="text-xl font-extrabold leading-none text-brand tabular-nums">
            {card.day}
          </span>
          <span className="mt-1 text-[10px] font-bold uppercase tracking-wider text-text-secondary">
            {card.month}
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col justify-center p-3">
          <span data-testid="live-card-pills" className="flex flex-wrap items-center gap-1">
            <AgendaStatus card={card} />
          </span>
          <span
            data-testid="live-card-title"
            className={cn(
              'mt-0.5 line-clamp-2 break-words text-sm font-bold leading-snug',
              card.cancelled ? 'text-text-secondary' : 'text-text',
            )}
          >
            {item.title}
          </span>
          <span
            data-testid="live-card-meta"
            className="mt-1 text-xs font-normal text-text-tertiary tabular-nums"
          >
            {card.timeLine}
          </span>
        </span>
      </a>
      <a
        href={item.href}
        aria-label={card.editAriaLabel}
        data-testid="live-edit"
        className="group flex min-w-11 shrink-0 items-center justify-center pr-3 pl-1 focus-visible:outline-none"
      >
        <span className={cn(TINT_EDIT, PILL_FOCUS)}>
          <Pencil aria-hidden size={11} className="shrink-0" />
          {t('lives.edit')}
        </span>
      </a>
    </div>
  );
}

/**
 * One admin live card. `item.live` carries the card words (`liveRowView`); `eager` is the cover's
 * loading hint (the spotlight and the first tiles).
 */
export function AdminLiveCard({
  item,
  card,
  variant,
  eager = false,
}: {
  item: CourseRowView;
  card: LiveCardFields;
  variant: AdminLiveCardVariant;
  eager?: boolean;
}) {
  if (variant === 'agenda') return <AgendaRow item={item} card={card} />;
  const spotlight = variant === 'spotlight';
  return (
    <div className="relative">
      <LiveCard
        variant={variant}
        href={item.href}
        ariaLabel={item.ariaLabel}
        title={item.title}
        meta={item.meta}
        statusLabel={card.statusLabel}
        statusIcon={card.statusIcon}
        coverAssetId={item.coverAssetId}
        coverWidths={PURPOSE_WIDTHS.cover}
        cancelled={card.cancelled}
        eager={eager}
      />
      <CoverEditDoor href={item.href} ariaLabel={card.editAriaLabel} spotlight={spotlight} />
    </div>
  );
}

/**
 * The cards' skeletons while a page is in flight, at the cards' geometry: agenda rows under
 * "Próximas", 16:10 tiles in the grid under "Passadas". No words.
 */
export function AdminLiveCardSkeletons({
  variant,
  count,
}: {
  variant: 'agenda' | 'tile';
  count: number;
}) {
  return (
    <div
      aria-busy
      data-testid="lives-skeleton"
      className={variant === 'tile' ? ADMIN_LIVES_GRID : 'flex flex-col gap-3'}
    >
      {Array.from({ length: count }, (_, index) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, static placeholder row.
          key={index}
          variant="rect"
          className={
            variant === 'tile' ? 'aspect-[16/10] h-auto rounded-xl' : 'h-[88px] rounded-xl'
          }
        />
      ))}
    </div>
  );
}
