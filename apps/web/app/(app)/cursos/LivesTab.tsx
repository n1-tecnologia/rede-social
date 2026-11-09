import type { LivePage } from '@rede-social/module-courses/contracts';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { COURSES_MODULE_DISABLED, getLives } from '@/lib/courses';
import { liveFilterFromParam, liveRowView } from '@/lib/courses-view';
import { ADMIN_SCREEN_TITLE_ID } from './admin-styles';
import { LivesList } from './LivesList';

/**
 * The body of the admin's Lives screen (08.3-11, D-416, UI-D-391, UI-D-392, UI-D-401),
 * server-composed: the first page, handed to `LivesList` as FINISHED row views (`liveRowView`: the
 * date line in the TENANT's timezone, the pill from the API's DERIVED status — no `Date.now()`
 * anywhere in the body, UI-D-407; a cancelled live stays in its time bucket with the "Cancelada"
 * pill), keyed by the filter so a chip switch starts from the server's page 1.
 *
 * 2026-10-22 (the courses area redesign): Lives is a page of its own (`/cursos/lives`); its frame
 * (`AdminListScreen`) draws the h1, the brand "Nova live" and the Próximas · Passadas chips
 * (`?filtro=`) outside this body's `Suspense`, so the old h2 title row and chips left this file; the
 * section is named by the screen's h1.
 *
 * 2026-10-23: the same row views now carry their card words (`liveRowView`'s `live`: the status in
 * words, the agenda's date parts, the "Editar" name), and `LivesList` draws them as the member's live
 * cards. Nothing changed in this file's reads.
 *
 * The first read's refusals split three ways (the Cursos tab's posture): `MODULE_DISABLED` → the
 * kernel not-found; a refusal the bootstrap knows → a navigation OUTSIDE the try/catch; anything
 * else → the first-load error card with its retry (E04 error).
 */
export async function LivesTab({
  filtro,
  tenantName,
  timeZone,
}: {
  filtro: string | string[] | undefined;
  tenantName: string;
  /** `bootstrap.tenant.timezone`: the zone every date line is formatted in. */
  timeZone: string;
}) {
  const t = await getTranslations();
  const filter = liveFilterFromParam(filtro);

  let page: LivePage | null = null;
  let path: string | null = null;
  let disabled = false;
  try {
    page = await getLives({ filter });
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.status === 404 && error.code === COURSES_MODULE_DISABLED) disabled = true;
      else path = bootstrapRedirectPath(error);
    }
    // Shape only: a live title is tenant content and never reaches a log line.
    if (!disabled && !path) {
      console.error('courses.lives_list_failed', {
        ...(error instanceof ApiClientError
          ? { status: error.status, code: error.code }
          : { error: String(error) }),
      });
    }
  }
  if (path) redirect(path);
  if (disabled) notFound();

  const items = (page?.items ?? []).map((row) => liveRowView(row, { timezone: timeZone }, t));

  return (
    <section
      aria-labelledby={ADMIN_SCREEN_TITLE_ID.lives}
      data-testid="lives-tab"
      className="flex flex-col px-4"
    >
      <LivesList
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
