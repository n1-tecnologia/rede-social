import { Skeleton } from '@rede-social/ui';

const TABS = [56, 48];

/**
 * `/cursos/loading.tsx` (08.5-06, UI-D-424, E02 loading): ROLE-NEUTRAL — the h1 and subtitle bars and
 * the tabs row only, the frame the manager's hub and the member catalogue share. Each body draws its
 * own skeleton inside its own `Suspense` fallback (the hub's rows in `page.tsx`, the member's posters
 * and live cards in `MemberCatalogue.tsx`), so this file never guesses who is loading. No words: the
 * skeleton says nothing about the page it waits for.
 */
export default function CoursesLoading() {
  return (
    <div aria-busy className="mx-auto flex w-full max-w-[680px] flex-col">
      <div className="flex flex-col gap-2 px-4 pt-4 pb-3">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <div className="mb-4 flex gap-2 border-b border-divider px-4">
        {TABS.map((width, index) => (
          <Skeleton
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, static placeholder row.
            key={index}
            variant="text"
            width={width}
            className="my-3 h-4 shrink-0"
          />
        ))}
      </div>
    </div>
  );
}
