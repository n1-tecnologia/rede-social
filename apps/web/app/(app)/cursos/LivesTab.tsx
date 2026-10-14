import type { LivePage } from '@rede-social/module-courses/contracts';
import { Chip, SectionTitle } from '@rede-social/ui';
import { Plus } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { COURSES_MODULE_DISABLED, getLives } from '@/lib/courses';
import {
  LIVE_FILTER_LABEL_KEY,
  LIVE_FILTER_ORDER,
  liveFilterFromParam,
  liveFilterHref,
  liveRowView,
} from '@/lib/courses-view';
import { LivesList } from './LivesList';

/** The brand create control (UI-D-391): 44px tall, `shrink-0`, the `sm` type with `Plus` 16. */
const CREATE_LINK =
  'inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-button bg-(image:--button-image) px-4 text-xs font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * The hub's Lives tab (08.3-11, D-416, UI-D-391, UI-D-392, UI-D-401), server-composed — the Trilhas
 * tab's shape with the live vocabulary:
 *
 *  - the title row — "Lives" as a `SectionTitle` h2 16/700 and the brand "Nova live";
 *  - the time chips Próximas · Passadas (`Chip` LINKS bound to `?aba=lives&filtro=`, read HERE on
 *    the server; an unknown value reads as "Próximas", E04 partial) in ONE non-wrapping row — a
 *    cancelled live stays in its time bucket with the "Cancelada" pill;
 *  - the first page, handed to `LivesList` as FINISHED row views (`liveRowView`: the date line in the
 *    TENANT's timezone, the pill from the API's DERIVED status — no `Date.now()` anywhere in the
 *    tab, UI-D-407), keyed by the filter so a chip switch starts from the server's page 1.
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
    <section aria-labelledby="lives-tab-title" data-testid="lives-tab" className="flex flex-col">
      <div className="px-4">
        <div className="flex items-center justify-between gap-3 pb-3">
          <SectionTitle
            id="lives-tab-title"
            variant="group"
            className="min-w-0 flex-1 truncate text-base font-bold text-text"
          >
            {t('courses.hub.tabs.lives')}
          </SectionTitle>
          <a href="/cursos/lives/nova" data-lives-create className={CREATE_LINK}>
            <Plus aria-hidden size={16} />
            {t('courses.hub.create.live')}
          </a>
        </div>

        {/* Never wraps: `shrink-0` chips in one row that scrolls at 320px (E04 overflow). */}
        <nav
          aria-label={t('courses.lives.filter.label')}
          data-testid="lives-filters"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-none"
        >
          {LIVE_FILTER_ORDER.map((key) => (
            <Chip key={key} href={liveFilterHref(key)} active={filter === key} className="shrink-0">
              {t(LIVE_FILTER_LABEL_KEY[key])}
            </Chip>
          ))}
        </nav>
      </div>

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
