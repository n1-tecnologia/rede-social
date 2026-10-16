import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MemberLessonThumb } from '@rede-social/module-courses/ui';
import type { NewLessonView } from '@/lib/courses-member-view';
import { HomeSectionHeader } from './HomeShelf';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * "Novas aulas da semana" (08.6-09, UI-D-454, COURSE-33), ported from the prototype's rail
 * (`app/membros/page.tsx` § 7) at 240px: a horizontal `<ul>` named by its heading, up to four items
 * in the SERVER's order, scrolling natively with the hidden scrollbar (no snap, UI-D-463). No "Ver
 * tudo": no such list exists. The host renders this only when the overview carries `newLessons`.
 *
 * Each item is one link to the lesson: the 16:9 `MemberLessonThumb` on the COURSE cover with the
 * "Nova" pill and the "mm:ss" chip (the shipped done state when `done`), the title (`line-clamp-2`)
 * and "{course} · {duration}" (`line-clamp-1`). Only lessons the member can open arrive (the server
 * filters locked ones, T-08.6-13), so no padlock is ever drawn here.
 */
export function HomeNewLessons({ items, title }: { items: NewLessonView[]; title: string }) {
  return (
    <section data-testid="courses-home-new-lessons" className="flex flex-col">
      <HomeSectionHeader id="courses-home-new-lessons-title" title={title} />
      <ul aria-label={title} className="flex gap-3 overflow-x-auto px-4 pb-2 scrollbar-none">
        {items.map((item) => (
          <li key={item.id} className="w-60 shrink-0">
            <a
              href={item.href}
              aria-label={item.ariaLabel}
              data-testid="courses-home-new-lesson"
              data-done={item.done}
              className={`block rounded-xl transition-opacity active:opacity-80 ${FOCUS}`}
            >
              <MemberLessonThumb
                state={item.done ? 'done' : 'open'}
                coverAssetId={item.coverAssetId}
                coverWidths={PURPOSE_WIDTHS.cover}
                sizes="240px"
                badge={item.badge}
                duration={item.duration ?? undefined}
                className="w-full rounded-xl"
              />
              <span
                data-testid="courses-home-new-lesson-title"
                className="mt-2 line-clamp-2 break-words text-sm font-bold leading-tight text-text"
              >
                {item.title}
              </span>
              <span className="mt-1 line-clamp-1 break-words text-xs font-normal text-text-tertiary tabular-nums">
                {item.meta}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
