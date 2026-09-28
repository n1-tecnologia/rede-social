import { EmptyState } from '@rede-social/ui';
import { FileQuestion } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getHostTenant, tenantDisplayName } from '@/lib/tenant-host';

/**
 * "Publicação não encontrada" — the ONE screen every miss on `/post/[postId]` lands on (UI-D-16).
 *
 * **Three different branches in code reach this one rendering, and a later reader must not
 * "improve" any of them into a distinguishable message:**
 *   1. an id that matches no post at all (or is not a uuid — the API answers 400, `loadPost`
 *      collapses it);
 *   2. a post belonging to ANOTHER tenant — RLS never returns the row to this caller's lane, so the
 *      API cannot tell it apart from (1) even if it wanted to;
 *   3. a post of THIS tenant whose soft-delete stamp is set — the read filter excludes that row.
 *
 * The three are distinguishable in the database and indistinguishable here on purpose. Any
 * difference — a word, a status code, a second CTA — would be an existence oracle over an
 * enumerable uuid space, which is the whole class of "did this exist?" probe D-23 removed from
 * `/membros/[membershipId]` in 03-05 and this route inherits.
 *
 * **It takes no props and reads no param on purpose** (the `/endereco-invalido` posture from
 * 01-05): a component that cannot see the id it was reached with cannot echo it. That rule is
 * unchanged, and it is the whole of the existence-oracle guarantee — the id never reaches this
 * file, so it can never be echoed back.
 *
 * **It DOES read the tenant** (UI-D-46): the body names the tenant rather than saying "desta
 * comunidade", because from Phase 5 on "comunidade" means the Phase 5 container on every
 * authenticated surface. That is safe to add and does not weaken the paragraph above: the name is
 * HOST-derived, so it is byte-identical across all three causes above and identical to what every
 * other screen on this host already shows. It carries no information about the requested resource,
 * which is the only thing this screen must not reveal. Do not re-litigate it.
 */
export default async function PostNotFound() {
  const [t, hostTenant] = await Promise.all([getTranslations('feed'), getHostTenant()]);
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3">
      <EmptyState
        variant="card"
        icon={FileQuestion}
        title={t('notFound.title')}
        body={t('notFound.body', { tenant: tenantDisplayName(hostTenant) })}
        action={
          <a
            href="/inicio"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
          >
            {t('notFound.cta')}
          </a>
        }
      />
    </div>
  );
}
