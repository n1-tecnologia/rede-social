import { EventPoster } from '@tria/module-events/ui';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadEvents } from '@/lib/events';
import { eventPosterView } from '@/lib/events-view';

/**
 * `/eventos` (EVENT-02) — the tenant's events, reached from the `Eventos` BottomNav/rail tab the
 * module's manifest declares (D-55, UI-D-215).
 *
 * Server-rendered from `GET /v1/events`, so the first paint already carries page 1. Every string is
 * built on the server by `lib/events-view.ts` in the TENANT's timezone (`bootstrap.tenant.timezone`)
 * from ONE request instant, so no client render reads the clock (UI-D-203).
 *
 * **`PageHeader`-less on purpose** (UI-D-200): a tab destination has nothing to go back to, so the
 * 24/700 heading and its subtitle sit in the column itself, the `/comunidades` shape.
 */
export default async function EventsPage() {
  const [bootstrap, t] = await Promise.all([requireBootstrap(), getTranslations('events')]);
  const page = await loadEvents({ period: 'upcoming' });
  const tz = bootstrap.tenant.timezone;
  // ONE clock read for the whole page: every relative label is computed from the same instant.
  const nowMs = Date.now();
  const posters = (page?.items ?? []).map((event) => eventPosterView(event, { tz, nowMs, t }));

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-2xl font-bold leading-tight tracking-[-0.02em] text-text">
          {t('list.title')}
        </h1>
        <p className="mt-1 text-sm font-normal text-text-secondary">{t('list.subtitle')}</p>
      </div>

      <section
        aria-label={t('list.regionUpcoming', { tenant: bootstrap.tenant.displayName })}
        className="grid grid-cols-1 gap-4 px-4 pb-6 sm:grid-cols-2"
      >
        {posters.map((poster, index) => (
          <EventPoster key={poster.id} {...poster} eager={index < 2} />
        ))}
      </section>
    </div>
  );
}
