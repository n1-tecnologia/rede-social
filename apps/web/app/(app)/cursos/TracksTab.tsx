import type { TrackPage } from '@rede-social/module-courses/contracts';
import { Chip, SectionTitle } from '@rede-social/ui';
import { Plus } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { COURSES_MODULE_DISABLED, getTracks } from '@/lib/courses';
import {
  TRACK_FILTER_LABEL_KEY,
  TRACK_FILTER_ORDER,
  trackFilterFromParam,
  trackFilterHref,
  trackRowView,
} from '@/lib/courses-view';
import { TracksList } from './TracksList';

/** The brand create control (UI-D-391): 44px tall, `shrink-0`, the `sm` type with `Plus` 16. */
const CREATE_LINK =
  'inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-button bg-(image:--button-image) px-4 text-xs font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * The hub's Trilhas tab (08.3-10, D-415, UI-D-391, UI-D-392, UI-D-401), server-composed — the Cursos
 * tab's shape with the track vocabulary:
 *
 *  - the title row — "Trilhas" as a `SectionTitle` h2 16/700 and the brand "Nova trilha";
 *  - the status chips Ativas · Arquivadas (`Chip` LINKS bound to `?aba=trilhas&filtro=`, read HERE on
 *    the server; an unknown value reads as "Ativas", E04 partial) in ONE non-wrapping row;
 *  - the first page, handed to `TracksList` as FINISHED row views (`trackRowView`: the meta "{N}
 *    cursos" counts the PUBLISHED courses the API counted, the "Arquivada" pill only when archived),
 *    keyed by the filter so a chip switch starts from the server's page 1.
 *
 * The first read's refusals split three ways (the Cursos tab's posture): `MODULE_DISABLED` → the
 * kernel not-found; a refusal the bootstrap knows → a navigation OUTSIDE the try/catch; anything
 * else → the first-load error card with its retry (E04 error).
 */
export async function TracksTab({
  filtro,
  tenantName,
}: {
  filtro: string | string[] | undefined;
  tenantName: string;
}) {
  const t = await getTranslations();
  const filter = trackFilterFromParam(filtro);

  let page: TrackPage | null = null;
  let path: string | null = null;
  let disabled = false;
  try {
    page = await getTracks({ filter });
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.status === 404 && error.code === COURSES_MODULE_DISABLED) disabled = true;
      else path = bootstrapRedirectPath(error);
    }
    // Shape only: a track title is tenant content and never reaches a log line.
    if (!disabled && !path) {
      console.error('courses.tracks_list_failed', {
        ...(error instanceof ApiClientError
          ? { status: error.status, code: error.code }
          : { error: String(error) }),
      });
    }
  }
  if (path) redirect(path);
  if (disabled) notFound();

  const items = (page?.items ?? []).map((row) => trackRowView(row, t));

  return (
    <section aria-labelledby="tracks-tab-title" data-testid="tracks-tab" className="flex flex-col">
      <div className="px-4">
        <div className="flex items-center justify-between gap-3 pb-3">
          <SectionTitle
            id="tracks-tab-title"
            variant="group"
            className="min-w-0 flex-1 truncate text-base font-bold text-text"
          >
            {t('courses.hub.tabs.tracks')}
          </SectionTitle>
          <a href="/cursos/trilhas/nova" data-tracks-create className={CREATE_LINK}>
            <Plus aria-hidden size={16} />
            {t('courses.hub.create.track')}
          </a>
        </div>

        {/* Never wraps: `shrink-0` chips in one row that scrolls at 320px (E04 overflow). */}
        <nav
          aria-label={t('courses.tracks.filter.label')}
          data-testid="tracks-filters"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-none"
        >
          {TRACK_FILTER_ORDER.map((key) => (
            <Chip
              key={key}
              href={trackFilterHref(key)}
              active={filter === key}
              className="shrink-0"
            >
              {t(TRACK_FILTER_LABEL_KEY[key])}
            </Chip>
          ))}
        </nav>
      </div>

      <TracksList
        key={filter}
        filter={filter}
        tenantName={tenantName}
        initialItems={items}
        initialCursor={page?.nextCursor ?? null}
        initialError={page === null}
      />
    </section>
  );
}
