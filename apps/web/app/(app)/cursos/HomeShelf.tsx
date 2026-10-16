import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { ProgressBar } from '@rede-social/module-courses/ui';
import { Card, SectionTitle } from '@rede-social/ui';
import { ChevronRight, CircleCheck, Lock } from 'lucide-react';
import type { ShelfRowView } from '@/lib/courses-member-view';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The tenant gradient (D-69): the no-cover and the failed-cover branch, in the same box. */
export function CoverGradient() {
  return (
    <span
      aria-hidden
      data-testid="courses-home-cover-fallback"
      className="absolute inset-0 block"
      style={{ backgroundImage: 'var(--brand-gradient)' }}
    />
  );
}

/**
 * A section's title row on Início (UI-D-450, UI-D-451): the shipped `SectionTitle` micro and, when
 * the section has a list elsewhere, the trailing "Ver tudo" text link (accent item 4, `ChevronRight`
 * 16) with its own accessible name. The link keeps a 44px hit area (UI-D-463 touch rule) and pulls
 * its extra height out of the row with a negative margin, so the title row stays its drawn height.
 */
export function HomeSectionHeader({
  id,
  title,
  seeAll,
}: {
  id: string;
  title: string;
  seeAll?: { href: string; label: string; ariaLabel: string };
}) {
  if (!seeAll) {
    return (
      <SectionTitle as="h3" id={id} className="mb-3 px-4">
        {title}
      </SectionTitle>
    );
  }
  return (
    <div className="mb-3 flex items-center justify-between gap-3 px-4">
      <SectionTitle as="h3" id={id} className="min-w-0">
        {title}
      </SectionTitle>
      <a
        href={seeAll.href}
        aria-label={seeAll.ariaLabel}
        className={`-my-3 inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-md text-xs font-bold text-brand ${FOCUS}`}
      >
        {seeAll.label}
        <ChevronRight aria-hidden size={16} />
      </a>
    </div>
  );
}

/**
 * "Meus cursos" (08.6-09, D-436, UI-D-450, COURSE-30), ported from the prototype's shelf
 * (`app/membros/page.tsx` § 4) with the 08.5 vocabulary: one card, up to three rows in the SERVER's
 * cascade (in progress, the track's next course, new, the locked shop window, completed), never
 * padded. The host renders this only when the overview carries `shelf` (UI-D-447).
 *
 * Each row is one link to the course page with the host-built name "{course}, {state}":
 *  - the 48px cover square, ALWAYS in colour, locked or not (D-421) — no desaturation, no veil;
 *  - the title (`line-clamp-1` inside `min-w-0 flex-1`, so the chevron keeps its place) and the
 *    legend by kind: the `h-1` bar on `em_andamento`, the 12px `Lock` on `bloqueado` ("Exclusivo",
 *    the shop window informs, never pressures — PR-5), the success `CircleCheck` on `concluido`;
 *  - the trailing `ChevronRight` 18.
 *
 * Every word arrives finished from `shelfRowView` and renders as React text (UI-D-463, T-08.6-25).
 */
export function HomeShelf({
  rows,
  title,
  seeAll,
}: {
  rows: ShelfRowView[];
  title: string;
  seeAll: { href: string; label: string; ariaLabel: string };
}) {
  return (
    <section data-testid="courses-home-shelf" className="flex flex-col">
      <HomeSectionHeader id="courses-home-shelf-title" title={title} seeAll={seeAll} />
      <Card className="mx-4 p-0">
        <ul
          aria-labelledby="courses-home-shelf-title"
          className="flex flex-col divide-y divide-divider"
        >
          {rows.map((row) => (
            <li key={row.id}>
              <a
                href={row.href}
                aria-label={row.ariaLabel}
                data-testid="courses-home-shelf-row"
                data-kind={row.kind}
                className={`flex min-h-14 items-center gap-3 p-3 transition-colors hover:bg-bg-hover ${FOCUS} focus-visible:ring-inset focus-visible:ring-offset-0`}
              >
                <span
                  aria-hidden
                  className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary"
                >
                  {row.coverAssetId ? (
                    <MediaImage
                      assetId={row.coverAssetId}
                      widths={PURPOSE_WIDTHS.cover}
                      alt=""
                      sizes="48px"
                      ratio=""
                      className="absolute inset-0 h-full w-full"
                      fallback={<CoverGradient />}
                    />
                  ) : (
                    <CoverGradient />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="line-clamp-1 break-words text-sm font-bold text-text">
                    {row.title}
                  </span>
                  {row.bar ? (
                    <ProgressBar
                      percent={row.bar.percent}
                      label={row.bar.label}
                      size="sm"
                      className="mt-1"
                    />
                  ) : null}
                  <span
                    data-testid="courses-home-shelf-legend"
                    className="mt-1 flex items-center gap-1 text-xs font-normal text-text-tertiary tabular-nums"
                  >
                    {row.kind === 'bloqueado' ? (
                      <Lock aria-hidden size={12} className="shrink-0" />
                    ) : null}
                    {row.kind === 'concluido' ? (
                      <CircleCheck aria-hidden size={12} className="shrink-0 text-success" />
                    ) : null}
                    <span className="min-w-0 truncate">{row.legend}</span>
                  </span>
                </span>
                <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
