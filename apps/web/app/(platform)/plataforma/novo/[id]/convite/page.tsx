import { Card } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import { AdminsPanel } from '@/components/platform/AdminsPanel';
import { DomainsPanel } from '@/components/platform/DomainsPanel';
import { WizardStepIntro, WizardStepNav } from '@/components/platform/WizardStep';
import { DraftReset } from '@/components/platform/wizard/WizardDraftGuards';
import { requirePlatformTenantDetail } from '@/lib/platform';
import { wizardStepMetadata } from '@/lib/wizard-metadata';

export const generateMetadata = () => wizardStepMetadata('invite');

/**
 * Wizard step 5 — Convite, the first step after the summary's confirmation created the tenant: the
 * first admin's invite (the tenant page's `AdminsPanel`, with its send/resend control), the domains
 * it waits for (D-36: the invite goes out once a domain is verified; `DomainsPanel` shows the DNS
 * records and verifies), and what was created (slug, enabled modules, primary domain). The way out
 * is the tenant page or a new tenant. Mounting it clears the wizard's draft (`DraftReset`).
 */
export default async function NewTenantInviteStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [t, tp, td, detail] = await Promise.all([
    getTranslations('platform.wizard'),
    getTranslations('platform'),
    getTranslations('platformDomains'),
    requirePlatformTenantDetail(id),
  ]);
  // The host the confirmation attached is primary from the start, but D-36 counts it only once
  // verified: until then it shows with its DNS status instead of "Sem domínio".
  const primary = detail.domains.find((d) => d.isPrimary) ?? null;
  const domainStatus = {
    pending: td('status.pending'),
    verified: td('status.verified'),
    expired: td('status.expired'),
    failed: td('status.failed'),
  };
  const email = detail.invites[0]?.email ?? null;
  const modules = detail.modules
    .filter((m) => m.enabled)
    .map((m) => tp(`moduleNames.${m.key}`))
    .join(', ');

  return (
    <div className="flex flex-col gap-6">
      <DraftReset tenantId={id} />
      <WizardStepIntro
        title={t('invite.title')}
        body={
          email
            ? t('invite.body', { tenant: detail.tenant.displayName, email })
            : t('invite.bodyNoInvite', { tenant: detail.tenant.displayName })
        }
      />
      <AdminsPanel tenantId={id} detail={detail} />
      <DomainsPanel tenantId={id} detail={detail} />
      <Card className="p-4 md:p-6">
        <dl className="grid gap-4 text-sm md:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
          <dt className="text-text-tertiary">{t('done.slug')}</dt>
          <dd className="min-w-0 break-words font-bold text-text">{detail.tenant.slug}</dd>
          <dt className="text-text-tertiary">{t('done.modules')}</dt>
          <dd className="min-w-0 text-text">{modules || t('done.noModules')}</dd>
          <dt className="text-text-tertiary">{t('done.domain')}</dt>
          <dd className="min-w-0 break-words text-text">
            {primary ? (
              <>
                {primary.host}
                {primary.verificationStatus === 'verified' ? null : (
                  <span className="text-text-tertiary">
                    {' · '}
                    {domainStatus[primary.verificationStatus]}
                  </span>
                )}
              </>
            ) : (
              tp('tenant.noHost')
            )}
          </dd>
        </dl>
      </Card>
      <WizardStepNav
        extra={{ href: '/plataforma/novo', label: t('actions.createAnother') }}
        next={{ href: `/plataforma/tenants/${id}/marca`, label: t('actions.openTenant') }}
      />
    </div>
  );
}
