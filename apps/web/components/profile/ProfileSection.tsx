import { Card, Skeleton } from '@rede-social/ui';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** The "Ver todos" link of a section's header. */
export interface ProfileSeeAll {
  href: string;
  /** The visible text ("Ver todos"). */
  label: string;
  /** The link's accessible name; it must CONTAIN `label` (label in name), e.g. "Ver todos os eventos". */
  ariaLabel: string;
}

export interface ProfileSectionProps {
  /**
   * The section's fixed key (`activity`, `events`, `communities`): `data-profile-section` and the
   * title's id (`profile-{id}-title`). Fixed rather than `useId`, so the section stays a server
   * component and a spec can address it.
   */
  id: string;
  title: string;
  seeAll?: ProfileSeeAll | null;
  /** A quiet line on the right of the title when there is no "Ver todos" (the window: "Últimos 7 dias"). */
  meta?: string | null;
  /**
   * `brand` (default): the galleries' title, brand ink in capitals. `prominent`: the dashboard
   * preview's report title ("Sua atividade"), larger, in the text ink and in sentence case.
   */
  titleStyle?: 'brand' | 'prominent';
  children: ReactNode;
}

/**
 * One section of `/perfil` under the hero (2026-10-12): the `/eventos` galleries' title (brand ink,
 * capitals, `data-brand-title` so the tenant's title font and colour reach it) with an optional
 * "Ver todos" link on the right, then its body. The title names the `<section>`. Props only, no
 * words of its own.
 */
export function ProfileSection({
  id,
  title,
  seeAll = null,
  meta = null,
  titleStyle = 'brand',
  children,
}: ProfileSectionProps) {
  const titleId = `profile-${id}-title`;
  return (
    <section aria-labelledby={titleId} data-profile-section={id}>
      <div className="mb-3 flex items-center justify-between gap-3 px-4">
        <h2
          id={titleId}
          data-brand-title={titleStyle === 'brand' || undefined}
          className={
            titleStyle === 'brand'
              ? 'text-sm font-bold uppercase tracking-wider text-brand'
              : 'text-lg font-extrabold text-text'
          }
        >
          {title}
        </h2>
        {seeAll ? (
          <Link
            href={seeAll.href}
            aria-label={seeAll.ariaLabel}
            className="inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-md text-xs font-bold text-text-secondary transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {seeAll.label}
            <ChevronRight aria-hidden size={14} />
          </Link>
        ) : meta ? (
          <span className="shrink-0 text-xs font-medium text-text-tertiary">{meta}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * The sideways rail of a section, the `/eventos` galleries' row: a list (assistive tech announces
 * how many), 256px items, no scrollbar on the phone and a thin one on the desktop.
 */
export function ProfileRail({ children }: { children: ReactNode }) {
  return (
    <ul className="flex gap-3 overflow-x-auto overscroll-x-contain px-4 pb-2 scrollbar-none md:scrollbar-thin">
      {children}
    </ul>
  );
}

/** One 256px slot of a `ProfileRail` (an `EventPoster`, a community tile). */
export function ProfileRailItem({ children }: { children: ReactNode }) {
  return <li className="w-64 shrink-0">{children}</li>;
}

const RAIL_SKELETON = [0, 1, 2];

/**
 * A rail while it streams, in the items' own geometry so nothing moves when they swap in: `poster`
 * is an `EventPoster` (4:5, 256×320), `tile` a community tile (16:9 cover over the counts row).
 * `h-auto` lifts the rect skeleton's default height, so the aspect ratio really sizes the box.
 */
export function ProfileRailSkeleton({ kind }: { kind: 'poster' | 'tile' }) {
  return (
    <div
      aria-busy
      data-testid="profile-rail-skeleton"
      data-kind={kind}
      className="flex gap-3 overflow-hidden px-4 pb-2"
    >
      {RAIL_SKELETON.map((index) =>
        kind === 'poster' ? (
          <Skeleton
            key={index}
            variant="rect"
            className="aspect-[4/5] h-auto w-64 shrink-0 rounded-xl"
          />
        ) : (
          <Card key={index} className="w-64 shrink-0">
            <Skeleton variant="rect" className="aspect-[16/9] h-auto w-full rounded-none" />
            <div className="flex items-center gap-2 px-4 py-3">
              <Skeleton variant="circle" className="h-[18px] w-[18px]" />
              <Skeleton variant="text" width="35%" className="h-3" />
            </div>
          </Card>
        ),
      )}
    </div>
  );
}

/** A section's empty or error card action: a filled CTA ("Explorar eventos") or an outline one. */
export interface ProfileEmptyAction {
  href: string;
  label: string;
  variant: 'filled' | 'outline';
}

export interface ProfileEmptyCardProps {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: ProfileEmptyAction | null;
}

/**
 * The two action styles: `filled` is the tenant's button (fill, gradient image and ink, the
 * "Meus eventos" empty card's CTA); `outline` is `/perfil`'s "Tentar novamente".
 */
const EMPTY_ACTION = {
  filled:
    'mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-button bg-(image:--button-image) px-5 text-xs font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
  outline:
    'mt-4 inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
} as const;

/**
 * A section's empty (or error) card, the "Meus eventos" empty card: the 48px disc with the brand
 * glyph, a title, one line and an optional action. A plain `<a>`, as on the empty cards it copies:
 * "Tentar novamente" must reload the document, not replay the client router.
 */
export function ProfileEmptyCard({
  icon: Icon,
  title,
  body,
  action = null,
}: ProfileEmptyCardProps) {
  return (
    <Card data-profile-empty className="mx-4 flex flex-col items-center px-6 py-8 text-center">
      <span
        aria-hidden
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-bg-input text-brand"
      >
        <Icon size={22} />
      </span>
      <p className="text-sm font-bold text-text">{title}</p>
      <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-text-secondary">{body}</p>
      {action ? (
        <a
          href={action.href}
          data-variant={action.variant}
          className={EMPTY_ACTION[action.variant]}
        >
          {action.label}
        </a>
      ) : null}
    </Card>
  );
}
