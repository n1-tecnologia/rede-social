import { StatusPill } from '@tria/ui';
import { ChevronLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { type ReactNode, Suspense } from 'react';
import { FlashToast } from '@/components/platform/FlashToast';
import { TenantTabs } from '@/components/platform/TenantTabs';
import { primaryVerifiedHost, requirePlatformTenantDetail } from '@/lib/platform';

/**
 * `/plataforma/tenants/{id}` — the tenant page frame (D-33 `tenant-page-*`): back control + "Tenants"
 * crumb, the title row (display name 24/700, status pill, slug 12 tertiary, verified primary host
 * as an external link or the "Sem domínio" pill) and the five tabs in the fixed order
 * Marca · Módulos · Domínios · Admins · Status, each a sub-route the tab pages fill in.
 *
 * The detail comes from `requirePlatformTenantDetail` (non-uuid or unknown id → the segment's
 * not-found screen; refusals redirect), deduplicated with the active tab page by React `cache`.
 * The slug is rendered as TEXT only: it is immutable after creation (D-31) — no input on this page.
 */
export default async function TenantLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: ReactNode;
}) {
  const { id } = await params;
  const [t, detail] = await Promise.all([
    getTranslations('platform'),
    requirePlatformTenantDetail(id),
  ]);
  const { tenant } = detail;
  const host = primaryVerifiedHost(detail);
  const active = tenant.status === 'active';

  return (
    <div className="flex flex-col">
      <Suspense fallback={null}>
        <FlashToast />
      </Suspense>
      <div className="-mx-2 flex items-center gap-1">
        <Link
          href="/plataforma"
          aria-label={t('tenant.back')}
          className="relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <ChevronLeft aria-hidden size={22} />
        </Link>
        <span className="text-base text-text-tertiary">{t('nav.tenants')}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 break-words text-2xl font-bold tracking-[-0.02em] text-text">
          {tenant.displayName}
        </h1>
        <StatusPill tone={active ? 'success' : 'danger'} data-testid="tenant-status-pill">
          {active ? t('tenantStatus.active') : t('tenantStatus.suspended')}
        </StatusPill>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text-tertiary">
        <span>{tenant.slug}</span>
        {host ? (
          <a
            href={`https://${host}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('tenant.openHost', { host })}
            className="inline-flex items-center gap-1 text-sm text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {host}
            <ExternalLink aria-hidden size={14} />
          </a>
        ) : (
          <StatusPill tone="warning">{t('tenant.noHost')}</StatusPill>
        )}
      </div>

      <TenantTabs tenantId={tenant.id} className="mt-4" />
      <section className="mt-6">{children}</section>
    </div>
  );
}
