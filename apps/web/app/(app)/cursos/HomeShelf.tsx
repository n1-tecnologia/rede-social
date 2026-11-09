import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MemberQuickCard } from '@rede-social/module-courses/ui';
import { cn } from '@rede-social/ui';
import type { CSSProperties } from 'react';
import type { QuickCourseView } from '@/lib/courses-home-view';
import { MemberSectionHeader } from './MemberSection';

/** One row only, as the reference's preview: the cards past the row's columns stay hidden. */
const ROW_ONLY = ['', '', 'hidden @xl:block', 'hidden @3xl:block', 'hidden @5xl:block'];

/**
 * Início's "Cursos" (2026-10-26, the academy reference's quick access, card for card: "Cursos ·
 * Acesso rápido aos seus cursos · 28 disponíveis · Ver todos"): the member's OPEN courses, the ones
 * they are taking first, as the reference's small card (`MemberQuickCard`: the inset cover, the
 * title, the 2px line of their share). ONE row, by the row's own width (container queries, so the
 * desktop rail does not count): two cards, three from 576px, four from 768px and five from 1024px.
 * Every word arrives from `quickCourseView`.
 *
 * It keeps the old shelf's hooks: `courses-home-shelf`, `courses-home-shelf-row` on each card and
 * `courses-home-shelf-legend` on its lessons line (read by a screen reader only).
 */
export function HomeShelf({
  cards,
  title,
  sub,
  seeAll,
}: {
  cards: QuickCourseView[];
  title: string;
  /** "Acesso rápido aos seus cursos · {n} disponíveis". */
  sub: string;
  seeAll: { href: string; label: string; ariaLabel: string };
}) {
  return (
    <section data-testid="courses-home-shelf" data-home-section className="flex flex-col">
      <MemberSectionHeader
        id="courses-home-shelf-title"
        title={title}
        sub={sub}
        seeAll={seeAll}
        className="mb-3.5"
      />
      <div className="@container px-4">
        <ul
          aria-labelledby="courses-home-shelf-title"
          className="grid grid-cols-2 gap-2.5 @xl:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-5"
        >
          {cards.map((card, index) => (
            <li
              key={card.id}
              data-course-card={card.id}
              className={cn('ms-rise min-w-0', ROW_ONLY[index])}
              style={{ '--ms-i': index } as CSSProperties}
            >
              <MemberQuickCard
                testId="courses-home-shelf-row"
                srLineTestId="courses-home-shelf-legend"
                href={card.href}
                ariaLabel={card.ariaLabel}
                title={card.title}
                coverAssetId={card.coverAssetId}
                coverWidths={PURPOSE_WIDTHS.cover}
                percent={card.percent}
                percentLabel={card.percentLabel}
                srLine={card.srLine}
                eager={index < 2}
                className="h-full"
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
