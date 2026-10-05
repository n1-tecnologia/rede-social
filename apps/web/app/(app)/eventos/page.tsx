import { EVENT_PERMISSIONS } from '@rede-social/module-events/contracts';
import { Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadEventSections } from '@/lib/events';
import { eventSectionsView } from '@/lib/events-view';
import { EventsSections } from './EventsSections';

/**
 * `/eventos` (EVENT-02) — the tenant's events, reached from the `Eventos` BottomNav/rail tab the
 * module's manifest declares (D-55, UI-D-215).
 *
 * **Two galleries (2026-10-03, the REINE prototype).** "Meus eventos" holds the events the member is
 * in (a "Vou" or a check-in) that have not ended, then the ended ones they checked in to; "Outros
 * eventos" holds the rest, the ones to come first. Each is a row of posters that scrolls sideways,
 * under its title in the brand's ink. The split is made here from the two periods the API already
 * pages (`loadEventSections`, `splitEventSections`): no new endpoint. The page has no visible title,
 * as in the prototype; its `h1` stays for assistive tech, and the galleries are its `h2`s.
 *
 * Every string is built on the server by `lib/events-view.ts` in the TENANT's timezone
 * (`bootstrap.tenant.timezone`) from ONE request instant, so no client render reads the clock
 * (UI-D-203). `PageHeader`-less on purpose: a tab destination has nothing to go back to.
 *
 * **06-04 — the manager's create control (D-212, UI-D-211, identical to UI-D-48).** ONE
 * `<a href="/eventos/novo">`, beside the first gallery's title, in every state: a 44×44 button
 * square with `Plus` 20 below `sm`, `Plus` 16 + "Criar evento" from `sm`, the label
 * `sr-only sm:not-sr-only` so the accessible name is always the catalog string. It is gated on the
 * composed `events.event.manage` PERMISSION from the bootstrap, never a role (T-06-19).
 */
export default async function EventsPage() {
  const [bootstrap, t] = await Promise.all([requireBootstrap(), getTranslations('events')]);

  const canManage = bootstrap.permissions.includes(EVENT_PERMISSIONS.manage);
  const loaded = await loadEventSections();
  const tz = bootstrap.tenant.timezone;
  // ONE clock read for the whole page: every relative label is computed from the same instant.
  const nowMs = Date.now();
  const sections = loaded ? eventSectionsView(loaded, { tz, nowMs, t }) : null;

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      <h1 className="sr-only">{t('list.title')}</h1>
      <EventsSections
        initial={sections}
        tenantName={bootstrap.tenant.displayName}
        canManage={canManage}
        createControl={
          canManage ? (
            <a
              href="/eventos/novo"
              data-events-create
              className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-button bg-(image:--button-image) text-sm font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:px-4"
            >
              <Plus aria-hidden size={20} className="sm:hidden" />
              <Plus aria-hidden size={16} className="hidden sm:block" />
              <span className="sr-only sm:not-sr-only">{t('actions.create')}</span>
            </a>
          ) : null
        }
      />
    </div>
  );
}
