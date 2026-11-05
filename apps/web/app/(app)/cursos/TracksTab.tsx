import type { TrackPage } from '@rede-social/module-courses/contracts';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { COURSES_MODULE_DISABLED, getTracks } from '@/lib/courses';
import { trackFilterFromParam, trackRowView } from '@/lib/courses-view';
import { ADMIN_SCREEN_TITLE_ID } from './admin-styles';
import { TracksList } from './TracksList';

/**
 * The body of the admin's Trilhas screen (08.3-10, D-415, UI-D-391, UI-D-392, UI-D-401),
 * server-composed: the first page, handed to `TracksList` as FINISHED row views (`trackRowView`: the
 * meta "{N} cursos" counts the PUBLISHED courses the API counted, the "Arquivada" pill only when
 * archived), keyed by the filter so a chip switch starts from the server's page 1.
 *
 * 2026-10-22 (the courses area redesign): Trilhas is a page of its own (`/cursos/trilhas`); its
 * frame (`AdminListScreen`) draws the h1, the brand "Nova trilha" and the Ativas · Arquivadas chips
 * (`?filtro=`) outside this body's `Suspense`, so the old h2 title row and chips left this file; the
 * section is named by the screen's h1.
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
    <section
      aria-labelledby={ADMIN_SCREEN_TITLE_ID.trilhas}
      data-testid="tracks-tab"
      className="flex flex-col px-4"
    >
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
