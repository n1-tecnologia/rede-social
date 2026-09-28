import { EmptyState } from '@rede-social/ui';
import { UserX } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getHostTenant, tenantDisplayName } from '@/lib/tenant-host';

/**
 * "Membro não encontrado" — the ONE screen every miss on `/membros/[membershipId]` lands on:
 * an unknown id, another tenant's id, an invited, a blocked or a soft-deleted membership. The API
 * already answers one indistinguishable bare 404 for all five (D-23/TENANT-04); this is the visual
 * half of the same rule, and it never tells the member WHY.
 *
 * **It takes no props and reads no param or search param on purpose** (the `/endereco-invalido`
 * posture from 01-05): a component that cannot see the id it was reached with cannot echo it. That
 * rule is unchanged, and it is the whole of the D-23/TENANT-04 guarantee — the id never reaches
 * this file, so it can never be echoed back.
 *
 * **It DOES read the tenant** (UI-D-46): the body names the tenant rather than saying "da sua
 * comunidade", because from Phase 5 on "comunidade" means the Phase 5 container on every
 * authenticated surface. That is safe to add and does not weaken the paragraph above: the name is
 * HOST-derived, so it is byte-identical across all five causes above and identical to what every
 * other screen on this host already shows. It carries no information about the requested
 * membership, which is the only thing this screen must not reveal. Do not re-litigate it.
 */
export default async function MemberNotFound() {
  const [t, hostTenant] = await Promise.all([getTranslations('members'), getHostTenant()]);
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3">
      <EmptyState
        variant="card"
        icon={UserX}
        title={t('notFound.title')}
        body={t('notFound.body', { tenant: tenantDisplayName(hostTenant) })}
        action={
          <a
            href="/membros"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
          >
            {t('notFound.cta')}
          </a>
        }
      />
    </div>
  );
}
