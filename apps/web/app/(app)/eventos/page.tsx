import { EVENT_PERMISSIONS, type EventPeriod } from '@tria/module-events/contracts';
import { Chip } from '@tria/ui';
import { Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadEvents } from '@/lib/events';
import { eventPosterView } from '@/lib/events-view';
import { EventsList } from './EventsList';

/**
 * `/eventos` (EVENT-02, D-200) — the tenant's events, reached from the `Eventos` BottomNav/rail tab
 * the module's manifest declares (D-55, UI-D-215).
 *
 * **Two chips, two keysets (UI-D-200).** `Próximos` (`/eventos`) is every event that has not ENDED,
 * so one in progress stays here until it ends; `Passados` (`/eventos?periodo=passados`) is every
 * ended event, most recent first. Cancelled events stay in both (D-201). The chips are `Chip` LINKS
 * read here on the server, for every member, so a chip switch, a refresh, back and a shared link all
 * land on the same list, and `EventsList` is keyed by the period so a switch starts from page 1.
 *
 * **D-93: a bad `?periodo=` is silent.** `past` is selected only when the value is EXACTLY the single
 * string `passados`; an array, a re-cased or unknown value, or no value lands on Próximos with no
 * error. The web translates its own pt-BR URL value and sends the API's closed `period` enum.
 *
 * Every string is built on the server by `lib/events-view.ts` in the TENANT's timezone
 * (`bootstrap.tenant.timezone`) from ONE request instant, so no client render reads the clock
 * (UI-D-203). `PageHeader`-less on purpose: a tab destination has nothing to go back to.
 *
 * **06-04 — the manager's create control (D-212, UI-D-211, identical to UI-D-48).** ONE
 * `<a href="/eventos/novo">` in the title row, in the empty and non-empty states and under both chips:
 * a 44×44 brand square with `Plus` 20 below `sm`, `Plus` 16 + "Criar evento" from `sm`, the label
 * `sr-only sm:not-sr-only` so the accessible name is always the catalog string. It is gated on the
 * composed `events.event.manage` PERMISSION from the bootstrap, never a role (T-06-19). No FAB, and no
 * "Evento" mode in `/criar`. The heading block is `min-w-0 flex-1` and the control `shrink-0`, so the
 * control keeps 44×44 and the heading wraps (UI E01/overflow).
 */
export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string | string[] }>;
}) {
  const [bootstrap, t, params] = await Promise.all([
    requireBootstrap(),
    getTranslations('events'),
    searchParams,
  ]);

  const canManage = bootstrap.permissions.includes(EVENT_PERMISSIONS.manage);
  const period: EventPeriod = params.periodo === 'passados' ? 'past' : 'upcoming';
  const page = await loadEvents({ period });
  const tz = bootstrap.tenant.timezone;
  // ONE clock read for the whole page: every relative label is computed from the same instant.
  const nowMs = Date.now();
  const posters = (page?.items ?? []).map((event) => eventPosterView(event, { tz, nowMs, t }));

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold leading-tight tracking-[-0.02em] text-text">
            {t('list.title')}
          </h1>
          <p className="mt-1 text-sm font-normal text-text-secondary">{t('list.subtitle')}</p>
        </div>
        {canManage ? (
          <a
            href="/eventos/novo"
            data-events-create
            className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-brand text-sm font-bold text-on-brand transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:px-4"
          >
            <Plus aria-hidden size={20} className="sm:hidden" />
            <Plus aria-hidden size={16} className="hidden sm:block" />
            <span className="sr-only sm:not-sr-only">{t('actions.create')}</span>
          </a>
        ) : null}
      </div>

      <nav aria-label={t('list.filter.label')} className="flex gap-2 px-4 pb-3">
        <Chip href="/eventos" active={period === 'upcoming'}>
          {t('list.filter.upcoming')}
        </Chip>
        <Chip href="/eventos?periodo=passados" active={period === 'past'}>
          {t('list.filter.past')}
        </Chip>
      </nav>

      <EventsList
        key={period}
        initialItems={posters}
        initialCursor={page?.nextCursor ?? null}
        initialError={page === null}
        tenantName={bootstrap.tenant.displayName}
        period={period}
        canManage={canManage}
      />
    </div>
  );
}
