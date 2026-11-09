import { iconFor } from '@rede-social/core/ui';
import { cn, SkinAmbient } from '@rede-social/ui';
import { ArrowUpRight } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { HomeAreaView } from '@/lib/courses-home-view';
import { MemberSectionHeader } from './MemberSection';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The grid by count; five make the bento (the first tile 2×2 from `lg`). */
const GRID: Record<number, string> = {
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-4 lg:grid-rows-2',
};

/**
 * "Mais da escola" (2026-10-26, the academy reference's bento of the academy's other places): the
 * school's other areas the member can open, as the menu names them (Lives, then Comunidades,
 * Eventos, Reels and Loja when the tenant has them on), each a tile with the menu's glyph, a short
 * line and "Acessar ↗". Two a row on a phone; with five, the first is the large tile of a 4-column
 * bento from `lg`. Only links: nothing of those areas is read here.
 */
export function HomeAreas({ areas, title }: { areas: HomeAreaView[]; title: string }) {
  const bento = areas.length === 5;
  return (
    <section data-testid="courses-home-areas" data-home-section className="flex flex-col">
      <MemberSectionHeader id="courses-home-areas-title" title={title} />
      <ul
        aria-labelledby="courses-home-areas-title"
        className={cn('grid grid-cols-2 gap-3 px-4 lg:gap-4', GRID[areas.length])}
      >
        {areas.map((area, index) => {
          const Icon = iconFor(area.icon);
          const big = bento && index === 0;
          const odd = areas.length % 2 === 1 && index === areas.length - 1 && !bento;
          return (
            <li
              key={area.key}
              style={{ '--ms-i': index } as CSSProperties}
              className={cn(
                'ms-rise min-w-0',
                (big || odd) && 'col-span-2',
                big && 'lg:row-span-2',
                odd && 'lg:col-span-1',
              )}
            >
              <a
                href={area.href}
                data-testid="courses-home-area"
                data-area={area.key}
                className={cn(
                  'ms-card ms-panel group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card p-4 transition-colors active:opacity-90 lg:p-5',
                  big ? 'min-h-[164px] lg:min-h-[300px] lg:rounded-3xl lg:p-7' : 'min-h-[148px]',
                  FOCUS,
                )}
              >
                {big ? <SkinAmbient /> : null}
                <span className="relative flex items-center justify-between gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      'flex shrink-0 items-center justify-center rounded-full bg-brand/12 text-brand ring-1 ring-brand/20',
                      big ? 'h-11 w-11' : 'h-9 w-9',
                    )}
                  >
                    <Icon size={big ? 20 : 16} />
                  </span>
                  <ArrowUpRight
                    aria-hidden
                    size={16}
                    className="shrink-0 text-text-tertiary transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-text motion-reduce:transition-none"
                  />
                </span>
                <span className="relative mt-auto flex min-w-0 flex-col pt-4">
                  <span className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-text-tertiary">
                    {area.eyebrow}
                  </span>
                  <span
                    data-testid="courses-home-area-title"
                    className={cn(
                      'ms-title-font mt-1 break-words font-medium leading-tight tracking-tight text-text',
                      big ? 'text-2xl lg:text-[32px]' : 'text-lg',
                    )}
                  >
                    {area.title}
                  </span>
                  <span
                    className={cn(
                      'mt-1.5 break-words text-xs font-normal leading-relaxed text-text-secondary',
                      big ? 'line-clamp-3 lg:max-w-sm lg:text-sm' : 'line-clamp-2',
                    )}
                  >
                    {area.body}
                  </span>
                  {big ? (
                    <span className="mt-4 inline-flex w-fit items-center gap-1 rounded-full bg-brand/12 px-3 py-1.5 text-xs font-semibold text-brand ring-1 ring-brand/25">
                      {area.cta}
                      <ArrowUpRight aria-hidden size={13} className="shrink-0" />
                    </span>
                  ) : null}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
