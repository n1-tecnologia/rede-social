import { EmptyState } from '@tria/ui';
import { FileQuestion } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getHostTenant, tenantDisplayName } from '@/lib/tenant-host';

/**
 * "Comunidade não encontrada" — the ONE screen every miss on `/comunidades/[communityId]` lands on
 * (D-23 / UI-D-16, T-05-20).
 *
 * **Three different branches in code reach this one rendering, and a later reader must not
 * "improve" any of them into a distinguishable message:**
 *   1. an id that matches no community at all (or is not a uuid — the API answers 400 and
 *      `loadCommunity` collapses it);
 *   2. a community belonging to ANOTHER tenant — RLS never returns the row to this caller's lane,
 *      so the API cannot tell it apart from (1) even if it wanted to;
 *   3. a community of THIS tenant whose soft-delete stamp is set.
 *
 * The three are distinguishable in the database and indistinguishable here on purpose. Any
 * difference — a word, a status code, a second CTA — would be an existence oracle over an
 * enumerable uuid space.
 *
 * **An ARCHIVED community is deliberately NOT one of them.** Archiving removes a community from the
 * list and refuses new posts; it never hides what is already published, so an archived community
 * still resolves and renders read-only (UI-D-37). A 404 here would break every shared link and every
 * feed post that names it.
 *
 * **It takes no props and reads no param on purpose:** a component that cannot see the id it was
 * reached with cannot echo it. It DOES read the tenant (UI-D-46) — a HOST-derived name, byte
 * identical across all three causes above, carrying no information about the requested resource.
 */
export default async function CommunityNotFound() {
  const [t, hostTenant] = await Promise.all([getTranslations('communities'), getHostTenant()]);
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3 px-4 pt-4">
      <EmptyState
        variant="card"
        icon={FileQuestion}
        title={t('notFound.title')}
        body={t('notFound.body', { tenant: tenantDisplayName(hostTenant) })}
        action={
          <a
            href="/comunidades"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
          >
            {t('actions.viewAll')}
          </a>
        }
      />
    </div>
  );
}
