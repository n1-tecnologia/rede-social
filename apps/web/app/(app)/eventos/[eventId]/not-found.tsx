import { EmptyState } from '@tria/ui';
import { CalendarX2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getHostTenant, tenantDisplayName } from '@/lib/tenant-host';

/**
 * "Evento não encontrado" — the ONE screen every miss on `/eventos/[eventId]` lands on (D-23,
 * T-06-14), cloned from the communities not-found.
 *
 * Three different causes reach this one rendering, and a later reader must not "improve" any of them
 * into a distinguishable message:
 *   1. an id that matches no event (or is not a uuid: the API answers 400 and `loadEvent` collapses
 *      it);
 *   2. an event of ANOTHER tenant: RLS never returns the row to this caller's lane, so the API cannot
 *      tell it apart from (1);
 *   3. an event of this tenant that moderation removed.
 * Any difference would be an existence oracle over an enumerable uuid space.
 *
 * It takes no props and reads no param: a component that cannot see the id cannot echo it. It reads
 * the HOST tenant's name, which is identical across the three causes.
 */
export default async function EventNotFound() {
  const [t, hostTenant] = await Promise.all([getTranslations('events'), getHostTenant()]);
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3 px-4 pt-4">
      <EmptyState
        variant="card"
        icon={CalendarX2}
        title={t('notFound.title')}
        body={t('notFound.body', { tenant: tenantDisplayName(hostTenant) })}
        action={
          <a
            href="/eventos"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
          >
            {t('notFound.cta')}
          </a>
        }
      />
    </div>
  );
}
