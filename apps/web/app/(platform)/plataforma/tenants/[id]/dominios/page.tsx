import { EmptyState, SectionTitle } from '@rede-social/ui';
import { Globe } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { AttachDomainForm } from '@/components/platform/AttachDomainForm';
import { DomainCard } from '@/components/platform/DomainCard';
import { requirePlatformTenantDetail } from '@/lib/platform';
import { toDomainCardView } from '@/lib/platform-domains';
import {
  attachDomainAction,
  removeDomainAction,
  restartDomainAction,
  setPrimaryDomainAction,
  verifyDomainAction,
} from './actions';

/**
 * Domínios tab (TENANT-07 UI half, D-34/D-35/D-36, mockup `tenant-page-dominios`): the always-visible
 * attach form, then one card per host in the API's order (primary first, then by creation — never
 * re-sorted here) or the empty state below the form. The detail comes from
 * `requirePlatformTenantDetail` (the segment re-proves the authorisation, deduplicated with the
 * layout's call by React `cache`); every label is built here, on the server, from
 * `platformDomains.json`, and dates are formatted before they reach the client.
 */
export default async function TenantDomainsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await requirePlatformTenantDetail(id);
  const t = await getTranslations('platformDomains');

  const views = detail.domains.map((domain) => toDomainCardView(domain, detail.domains.length));

  const shared = {
    status: {
      pending: t('status.pending'),
      verified: t('status.verified'),
      expired: t('status.expired'),
      failed: t('status.failed'),
    },
    primary: t('primary'),
    helper: t('helper'),
    card: {
      neverChecked: t('card.neverChecked'),
      verify: t('card.verify'),
      verifying: t('card.verifying'),
      restart: t('card.restart'),
      restarting: t('card.restarting'),
      setPrimary: t('card.setPrimary'),
      remove: t('card.remove'),
      removePrimaryHelper: t('card.removePrimaryHelper'),
    },
    dns: {
      title: t('dns.title'),
      type: t('dns.type'),
      name: t('dns.name'),
      value: t('dns.value'),
      copy: t('dns.copy'),
      copied: t('dns.copied'),
    },
    confirm: {
      removeBody: t('confirm.removeBody'),
      remove: t('confirm.remove'),
      primaryBody: t('confirm.primaryBody'),
      primary: t('confirm.primary'),
      cancel: t('confirm.cancel'),
    },
    toasts: {
      removed: t('toasts.removed'),
      primaryUpdated: t('toasts.primaryUpdated'),
      verified: t('toasts.verified'),
      restarted: t('toasts.restarted'),
      error: t('toasts.error'),
    },
    errors: {
      expired: t('errors.expired'),
      notExpired: t('errors.notExpired'),
      notVerified: t('errors.notVerified'),
      removePrimary: t('errors.removePrimary'),
      notFound: t('errors.notFound'),
      generic: t('errors.generic'),
      verifyFailedTemplate: t.raw('errors.verifyFailed'),
      verifyPendingReason: t('errors.verifyPendingReason'),
    },
  };

  const actions = {
    verify: verifyDomainAction,
    setPrimary: setPrimaryDomainAction,
    remove: removeDomainAction,
    restart: restartDomainAction,
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle variant="micro">{t('title')}</SectionTitle>
      <AttachDomainForm
        action={attachDomainAction.bind(null, id)}
        labels={{
          label: t('add.label'),
          placeholder: t('add.placeholder'),
          submit: t('add.submit'),
          pending: t('add.pending'),
          errors: {
            invalid: t('errors.invalid'),
            taken: t('errors.taken'),
            platformHost: t('errors.platformHost'),
            generic: t('errors.generic'),
          },
          added: t('toasts.added'),
        }}
      />
      {views.length === 0 ? (
        <EmptyState variant="card" icon={Globe} title={t('empty.title')} body={t('empty.body')} />
      ) : (
        views.map((view) => (
          <DomainCard
            key={view.id}
            tenantId={id}
            view={view}
            actions={actions}
            labels={{
              ...shared,
              confirmRemoveTitle: t('confirm.removeTitle', { host: view.host }),
              confirmPrimaryTitle: t('confirm.primaryTitle', { host: view.host }),
              lastErrorLabel: view.lastError
                ? t('card.lastError', { reason: view.lastError })
                : null,
            }}
          />
        ))
      )}
    </div>
  );
}
