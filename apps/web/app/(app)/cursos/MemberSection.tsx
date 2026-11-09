import { MEMBER_SECTION_TITLE, RAIL } from '@rede-social/module-courses/ui';
import { cn } from '@rede-social/ui';
import { ChevronRight } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The tenant gradient (D-69): the no-cover and the failed-cover branch, in the same box. */
export function CoverGradient({ testId = 'courses-home-cover-fallback' }: { testId?: string }) {
  return (
    <span
      aria-hidden
      data-testid={testId}
      className="absolute inset-0 block"
      style={{ backgroundImage: 'var(--brand-gradient)' }}
    />
  );
}

/**
 * 2026-10-22 — a section's title row in the member area (the social-igoralves prototype's
 * `ShelfRow` header), shared by every member screen: the title 17/800 tight (`MEMBER_SECTION_TITLE`,
 * an `h2` under the screen's h1 by default) and, on the right, either the "Ver tudo ›" text link in
 * the brand ink with its own accessible name, or a quiet count ("4 módulos · 18 aulas"). The link
 * keeps a 44px hit area and pulls its extra height out of the row with a negative margin, so the row
 * stays its drawn height. Replaces Início's `HomeSectionHeader` and the screens' micro titles.
 *
 * 2026-10-23: the row is never shorter than 20px, the "Ver tudo" link's own height (its 44px hit area
 * minus the negative margins), so two headers side by side ("Sua trilha" beside "Próxima live") put
 * their titles on the same line whether or not one has the link.
 *
 * 2026-10-26 (the member skin): the title is the skin's section title (`ms-title-section`, 17 to
 * 20px, 500) in the tenant's title font (`ms-title-font`), and the link's chevron steps forward on
 * hover. An optional `sub` line under the title (the academy reference's "Acesso rápido aos seus
 * cursos · 28 disponíveis").
 */
export function MemberSectionHeader({
  id,
  title,
  as: Heading = 'h2',
  seeAll,
  count,
  countTestId,
  sub,
  className,
}: {
  id: string;
  title: string;
  as?: 'h2' | 'h3';
  seeAll?: { href: string; label: string; ariaLabel: string } | null;
  /** A quiet count on the right, when there is no "Ver tudo". */
  count?: string | null;
  countTestId?: string;
  /** A quiet line under the title. */
  sub?: string | null;
  className?: string;
}) {
  return (
    <div className={cn('mb-2.5 flex min-h-5 items-end justify-between gap-3 px-4', className)}>
      {sub ? (
        <div className="flex min-w-0 flex-col">
          <Heading
            id={id}
            className={cn(
              MEMBER_SECTION_TITLE,
              'ms-title-section ms-title-font min-w-0 break-words',
            )}
          >
            {title}
          </Heading>
          <p className="mt-1.5 text-xs font-normal text-text-tertiary tabular-nums">{sub}</p>
        </div>
      ) : (
        <Heading
          id={id}
          className={cn(MEMBER_SECTION_TITLE, 'ms-title-section ms-title-font min-w-0 break-words')}
        >
          {title}
        </Heading>
      )}
      {seeAll ? (
        <a
          href={seeAll.href}
          aria-label={seeAll.ariaLabel}
          className={`group -my-3 inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-md text-xs font-semibold text-brand ${FOCUS}`}
        >
          {seeAll.label}
          <ChevronRight
            aria-hidden
            size={14}
            className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        </a>
      ) : count ? (
        <span
          data-testid={countTestId}
          className="max-w-[50%] shrink-0 truncate text-xs font-normal text-text-tertiary tabular-nums"
        >
          {count}
        </span>
      ) : null}
    </div>
  );
}

/**
 * 2026-10-22 — the member area's horizontal shelf (the prototype's `ShelfRow` body, `RAIL`): an
 * `<ul>` named by its heading that bleeds to the screen's edges on a phone (the last card cut by the
 * edge says there is more), snaps card by card and keeps the 16px gutter. Each child is an `<li>` the
 * host sizes (`shrink-0 snap-start`, and `md:w-auto` for the desktop grid).
 *
 * 2026-10-23 (the wide desktop): from `md` the shelf is a wrapping grid with no scrollbar; `itemMin`
 * is the narrowest a card may get there (the grid fits as many columns as it can).
 */
export function MemberRail({
  labelledBy,
  testId,
  itemMin,
  className,
  children,
}: {
  labelledBy: string;
  testId?: string;
  /** The desktop grid's minimum card width, in px (`--rail-item`); 180 when unset. */
  itemMin?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ul
      aria-labelledby={labelledBy}
      data-testid={testId}
      className={cn(RAIL, className)}
      style={itemMin ? ({ '--rail-item': `${itemMin}px` } as CSSProperties) : undefined}
    >
      {children}
    </ul>
  );
}
