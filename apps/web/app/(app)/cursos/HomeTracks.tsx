import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MemberTrackCard } from '@rede-social/module-courses/ui';
import { cn } from '@rede-social/ui';
import type { CSSProperties } from 'react';
import type { HomeTrackCardView } from '@/lib/courses-home-view';
import { MemberSectionHeader } from './MemberSection';

/** The reference's row: three cards and, beside them, a narrower column holding the stack. */
const WITH_STACK =
  'grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,0.6fr)] xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,0.55fr)]';

/** Without a stack: one card spans the row, two share it, three from `lg`. */
const COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-2 lg:grid-cols-3',
};

/** The stack's box: as tall as a big card, its tiles splitting it. */
const STACK =
  'grid h-full min-h-0 gap-2 aspect-[3/4] sm:aspect-auto sm:h-[300px] lg:h-[clamp(280px,calc(var(--screen-h)*0.36),420px)] lg:gap-3';

/**
 * Início's tracks (2026-10-26, the academy reference's "Create · Agents · Build" row, its layout and
 * its card; the product owner: "um layout parecido com da imagem 2 e o modelo de card igual"): the
 * first three tracks as large cover cards (`MemberTrackCard` `lg`: breathing glows, "Acesse ↗", the
 * share and the band), and the fourth and fifth stacked in a narrower column as small tiles
 * (`MemberTrackCard` `sm`), the member's own track first. Two columns on a phone (the stack takes
 * the fourth cell), the reference's 3 + 0.6 from `lg`. Each card rises into place after the one
 * before it (`ms-rise`) and opens the track's page on Trilhas. Every word arrives from
 * `homeTrackCards`.
 */
export function HomeTracks({
  cards,
  title,
  seeAll,
}: {
  cards: HomeTrackCardView[];
  title: string;
  seeAll: { href: string; label: string; ariaLabel: string };
}) {
  const big = cards.slice(0, 3);
  const stack = cards.slice(3, 5);
  return (
    <section data-testid="courses-home-track" data-home-section className="flex flex-col">
      <MemberSectionHeader id="courses-home-track-title" title={title} seeAll={seeAll} />
      <ul
        aria-labelledby="courses-home-track-title"
        className={cn(
          'grid gap-3 px-4 lg:gap-4',
          stack.length > 0 ? WITH_STACK : (COLUMNS[big.length] ?? COLUMNS[3]),
        )}
      >
        {big.map((card, index) => (
          <li
            key={card.id}
            data-featured={card.featured || undefined}
            className="ms-rise min-w-0"
            style={{ '--ms-i': index } as CSSProperties}
          >
            <MemberTrackCard
              id={card.id}
              href={card.href}
              ariaLabel={card.ariaLabel}
              title={card.title}
              eyebrow={card.eyebrow}
              cta={card.cta}
              line={card.line}
              subtitle={card.subtitle}
              tag={card.audience}
              percent={card.percent}
              coverAssetId={card.coverAssetId}
              coverWidths={PURPOSE_WIDTHS.cover}
              index={index}
              eager={index === 0}
            />
          </li>
        ))}
        {stack.length > 0 ? (
          <li
            data-testid="courses-home-track-stack"
            className="ms-rise min-w-0"
            style={{ '--ms-i': 3 } as CSSProperties}
          >
            <ul className={cn(STACK, stack.length > 1 ? 'grid-rows-2' : 'grid-rows-1')}>
              {stack.map((card) => (
                <li key={card.id} className="min-h-0">
                  <MemberTrackCard
                    size="sm"
                    id={card.id}
                    href={card.href}
                    ariaLabel={card.ariaLabel}
                    title={card.title}
                    eyebrow={card.eyebrow}
                    cta={card.cta}
                    percent={card.percent}
                    coverAssetId={card.coverAssetId}
                    coverWidths={PURPOSE_WIDTHS.cover}
                  />
                </li>
              ))}
            </ul>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
