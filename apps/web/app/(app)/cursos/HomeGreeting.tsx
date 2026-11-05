import type { HomeGreetingView, PopularCategoryView } from '@/lib/courses-home-view';
import { CatalogueSearch } from './CatalogueSearch';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * Início's opening (2026-10-26, the academy reference's home): centred, the greeting by the part of
 * the day in the school's zone ("Boa tarde, Thiago!", the page's ONE h1, large and thin), the
 * question under it ("O que você quer aprender agora?") and the catalogue search as the large glass
 * box (`CatalogueSearch` `panel`, a GET to Cursos), with "Populares:" and the categories with the
 * most courses as chips under a hairline. FRONT ONLY: the search filters the catalogue the Cursos
 * screen already reads (no AI, no new API); a chip opens the catalogue filtered.
 */
export function HomeGreeting({
  view,
  search,
  popular,
  popularLabel,
}: {
  view: HomeGreetingView;
  search: {
    action: string;
    preview: boolean;
    label: string;
    placeholder: string;
    submitLabel: string;
  };
  popular: PopularCategoryView[];
  /** "Populares:" */
  popularLabel: string;
}) {
  return (
    <section
      data-testid="courses-home-greeting"
      data-home-section
      aria-labelledby="courses-home-greeting-title"
      className="flex flex-col items-center px-4 pt-4 text-center md:pt-10"
    >
      <h1
        id="courses-home-greeting-title"
        data-brand-title
        className="ms-title-display max-w-full break-words text-[28px] font-medium leading-tight tracking-tight text-text md:text-4xl"
      >
        {view.title}
      </h1>
      <p
        data-testid="courses-home-greeting-ask"
        className="mt-2.5 text-base font-normal text-text-secondary md:mt-3 md:text-lg lg:text-xl"
      >
        {view.ask}
      </p>
      <CatalogueSearch
        variant="panel"
        action={search.action}
        preview={search.preview}
        label={search.label}
        placeholder={search.placeholder}
        submitLabel={search.submitLabel}
        testId="courses-home-search"
        className="mt-6 max-w-2xl text-left md:mt-8"
        footer={
          popular.length > 0 ? (
            <div
              data-testid="courses-home-popular"
              className="-my-1 flex items-center gap-2 overflow-x-auto overscroll-x-contain py-1 scrollbar-none"
            >
              <span className="shrink-0 text-xs font-normal text-text-tertiary">
                {popularLabel}
              </span>
              {popular.map((category) => (
                <a
                  key={category.id}
                  href={category.href}
                  data-testid="courses-home-popular-chip"
                  className={`ms-chip-surface inline-flex min-h-8 max-w-[14rem] shrink-0 items-center rounded-full bg-bg-tertiary px-3 text-xs font-medium text-text-secondary transition-colors hover:text-text ${FOCUS}`}
                >
                  <span className="truncate">{category.name}</span>
                </a>
              ))}
            </div>
          ) : null
        }
      />
    </section>
  );
}
