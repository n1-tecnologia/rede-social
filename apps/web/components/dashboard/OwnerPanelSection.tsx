import { resolveBranding } from '@rede-social/contracts';
import { DashMotion } from '@rede-social/module-dashboard/ui';
import { getTranslations } from 'next-intl/server';
import { parseOwnerMembersView } from '@/lib/owner-band-scope';
import { parseOwnerContentView } from '@/lib/owner-content-view';
import { parseOwnerFinanceView } from '@/lib/owner-finance-view';
import {
  isOwnerPanelQuery,
  OWNER_PANEL_ANCHOR,
  type OwnerPanelFlags,
  type OwnerPanelTenant,
  parseOwnerArea,
} from '@/lib/owner-panel';
import type { HostShell } from '@/lib/tenant-host';
import { OwnerPanelScroll } from './OwnerPanelScroll';
import { TenantOwnerPanel } from './TenantOwnerPanel';

type SearchParams = Record<string, string | string[] | undefined>;

export interface OwnerPanelSectionProps {
  /** `bootstrap.tenant.displayName`: the header's name. */
  tenantName: string;
  /** `bootstrap.tenant.branding` (resolved by the API): the header's mark comes from its icon. */
  branding: unknown;
  /** The host the page was served on (`getHostTenant()`, which the page already read). */
  host: HostShell;
  /** The page's query: the area, and the list or detail open inside it. */
  query: SearchParams;
  /** `bootstrap.tenant.timezone` (08.7-01): the snapshot's days and build times are the tenant's. */
  timeZone: string;
  /** The panel's module flags, computed once by the page (`ownerPanelFlags`, 08.7-05). */
  flags: OwnerPanelFlags;
}

/**
 * The client owner's panel on `/perfil` (2026-10-15), for the tenant admin only (the page decides):
 * the section that holds it, right under "Complete seu perfil". It is the panel's `@container` (its
 * layout follows the section's width, not the window's), it mounts the panel's motion once
 * (`DashMotion`: the cards rise in, the numbers count, the charts sweep) and the landing on a step
 * (`OwnerPanelScroll`), and it reads the query level by level through the panel's allow-lists, so a
 * hand-typed URL never reaches markup.
 *
 * The tenant is the real one: its name, its app icon over the initial and, in "Conta", its host. On
 * a tenant host that is the tenant's primary host (`proxy.ts` folds every verified alias into it
 * with a 308, so the host the page is served on IS the primary) and it is verified; on a generic host
 * (localhost, a preview deploy) it is the host itself, not verified. No lookup of its own. Every
 * number is the sample's (`docs/pendencias-backend.md` item 10).
 */
export async function OwnerPanelSection({
  tenantName,
  branding,
  host,
  query,
  timeZone,
  flags,
}: OwnerPanelSectionProps) {
  const t = await getTranslations('dashboard');
  const tenant: OwnerPanelTenant = {
    name: tenantName,
    iconUrl: resolveBranding(branding).iconUrls?.i192 ?? null,
    domain: host.host,
    domainVerified: host.mode === 'tenant',
  };

  return (
    <section
      id={OWNER_PANEL_ANCHOR}
      aria-label={t('tenantOwner.header.subtitle')}
      data-profile-section="owner"
      className="@container min-w-0 scroll-mt-20 px-4"
    >
      <DashMotion />
      <OwnerPanelScroll anchor={OWNER_PANEL_ANCHOR} land={isOwnerPanelQuery(query)} />
      <TenantOwnerPanel
        tenant={tenant}
        area={parseOwnerArea(query)}
        members={parseOwnerMembersView(query, flags)}
        content={parseOwnerContentView(query)}
        finance={parseOwnerFinanceView(query)}
        flags={flags}
        timeZone={timeZone}
      />
    </section>
  );
}
