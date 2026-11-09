import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MemberLessonCard } from '@rede-social/module-courses/ui';
import { buttonClasses, MemberSkin, PageHeader } from '@rede-social/ui';
import { BookOpen, CircleCheck, Play } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ModulePageView } from '@/lib/courses-member-view';
import type { CoursesTranslator } from '@/lib/courses-view';
import {
  DETAIL_GRID,
  HeroChip,
  MemberDetailHero,
  MemberDetailSection,
  MemberProgressPanel,
} from '../../../MemberDetail';
import { riseStyle } from '../../../rise';

/**
 * A module's own page (2026-10-26, the academy reference's module page; the user's "swap completo"):
 * what the course page's module card opens. Top to bottom:
 *
 *  - on a phone, the sticky `PageHeader` (back to the course);
 *  - the reference's hero: the course cover as the ground with the module's name drawn very large
 *    and faint behind the words, the way back to the course (from `md`), the title (the page's h1),
 *    "Aprofunde seus conhecimentos com as aulas deste módulo.", the chips ("12 aulas",
 *    "1 concluídas", "8% completo") and the module's next lesson ("Começar aula" / "Retomar aula");
 *  - "Seu progresso no módulo", the bar and its share;
 *  - "Aulas": the lessons as the reference's cards (`MemberLessonCard`), every one a link, a locked
 *    one too (its page says why and holds the way to unlock it, UI-D-431).
 *
 * Everything comes from the member's course read (`modulePageView`): titles only, the server's locks
 * and numbers. A WIDE page (`data-shell-full`).
 */
export async function MemberModulePage({ view }: { view: ModulePageView }) {
  const t = (await getTranslations()) as unknown as CoursesTranslator;
  return (
    <MemberSkin>
      <div
        data-testid="member-module-page"
        data-module-id={view.moduleId}
        data-shell-full
        className="mx-auto flex w-full flex-col gap-6 pb-8 md:gap-8"
      >
        <PageHeader
          title={view.title}
          titleAs="p"
          backHref={view.courseHref}
          backLabel={t('courses.member.player.toCourse')}
          className="md:hidden"
        />

        <MemberDetailHero
          back={{ href: view.courseHref, label: view.courseTitle }}
          coverAssetId={view.coverAssetId}
          eyebrow={view.pill}
          title={view.title}
          description={t('courses.member.modulePage.sub')}
          watermark={`${view.title} ${view.numeral}`}
          chips={
            <>
              <HeroChip icon={BookOpen} testId="member-module-chip-lessons">
                {t('courses.member.chips.lessons', { N: view.total })}
              </HeroChip>
              {view.done > 0 ? (
                <HeroChip icon={CircleCheck} testId="member-module-chip-done">
                  {t('courses.member.chips.done', { n: view.done })}
                </HeroChip>
              ) : null}
              {view.percent > 0 ? (
                <HeroChip tone="brand" testId="member-module-chip-progress">
                  {t('courses.member.chips.percent', { percent: view.percent })}
                </HeroChip>
              ) : null}
            </>
          }
          actions={
            view.next ? (
              <a
                href={view.next.href}
                data-testid="member-module-next"
                className={buttonClasses({
                  variant: 'brand',
                  size: 'lg',
                  className: 'w-full gap-2 sm:w-auto',
                })}
              >
                <Play aria-hidden size={17} fill="currentColor" />
                {view.next.label}
              </a>
            ) : null
          }
          testIds={{
            root: 'member-module-hero',
            title: 'member-module-title',
            chips: 'member-module-chips',
          }}
        />

        <MemberProgressPanel
          testId="member-module-progress"
          title={t('courses.member.modulePage.progressTitle')}
          percent={view.percent}
          barLabel={t('courses.member.progress.aria', { percent: view.percent })}
        />

        <MemberDetailSection
          id="module-lessons"
          title={t('courses.member.modulePage.lessonsTitle')}
          testId="member-module-lessons"
        >
          <ul aria-labelledby="module-lessons" className={DETAIL_GRID}>
            {view.lessons.map((lesson, index) => (
              <li key={lesson.id} className="ms-rise min-w-0" style={riseStyle(index)}>
                <MemberLessonCard
                  id={lesson.id}
                  href={lesson.href}
                  ariaLabel={lesson.ariaLabel}
                  title={lesson.title}
                  pill={lesson.pill}
                  state={lesson.state}
                  percent={lesson.percent}
                  percentLabel={lesson.percentLabel}
                  doneLabel={t('courses.member.modulePage.cardMetaDone')}
                  duration={lesson.duration}
                  meta={lesson.meta}
                  current={lesson.current}
                  coverAssetId={view.coverAssetId}
                  coverWidths={PURPOSE_WIDTHS.cover}
                />
              </li>
            ))}
          </ul>
        </MemberDetailSection>
      </div>
    </MemberSkin>
  );
}
