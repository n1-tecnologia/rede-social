import type { OwnerAlert } from '@rede-social/module-dashboard/contracts';
import { type AttentionItem, AttentionList } from '@rede-social/module-dashboard/ui';
import type { ReactNode } from 'react';
import { cn, SectionTitle } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import { AlertsBell } from './AlertsBell';
import { TenantMark } from './TenantMark';

export interface PanelHeaderProps {
  /** The tenant's display name (its initial is the mark's fallback). */
  title: string;
  /** The tenant's square app icon over the mark, or null for the initial alone. */
  iconUrl?: string | null;
  subtitle?: string;
  /**
   * The period the numbers cover ("30 dias"), as plain gray text: no pill, border or background, so
   * it never reads as a button (quick 261014-ia8 E-3); the panel has no filter to change.
   */
  period?: string;
  /** Already-translated alerts: a non-empty list puts a bell on the right that opens them. */
  alerts?: readonly AttentionItem[];
  /** Placement in the host's layout. */
  className?: string;
}

/**
 * The panel's top bar (the reference's app bar, without its device frame): the tenant's mark (its
 * app icon, else a brand-filled initial), the title and a subtitle, and on the right the period and,
 * when there are alerts, a bell whose list opens under the header.
 */
export async function PanelHeader({
  title,
  iconUrl = null,
  subtitle,
  period,
  alerts,
  className,
}: PanelHeaderProps) {
  const t = await getTranslations('dashboard.alerts');
  const count = alerts?.length ?? 0;
  const urgentCount = alerts?.filter((item) => item.tone === 'danger').length ?? 0;

  return (
    <div className={cn('relative flex items-center justify-between gap-3', className)}>
      <div className="flex min-w-0 items-center gap-3">
        <TenantMark initial={title.charAt(0).toUpperCase()} iconUrl={iconUrl} />
        <div className="flex min-w-0 flex-col [overflow-wrap:anywhere]">
          <p className="text-base font-extrabold leading-tight text-text">{title}</p>
          {subtitle ? <p className="text-xs text-text-secondary">{subtitle}</p> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {period ? (
          <span data-panel-period className="shrink-0 text-xs text-text-secondary">
            {period}
          </span>
        ) : null}
        {alerts && count > 0 ? (
          <AlertsBell
            label={
              urgentCount > 0
                ? t('buttonUrgent', { count, urgent: urgentCount })
                : t('button', { count })
            }
            closeLabel={t('close')}
            count={count}
            urgent={urgentCount > 0}
          >
            <div className="flex flex-col gap-3">
              <SectionTitle as="h3" variant="group">
                {t('title', { count })}
              </SectionTitle>
              <AttentionList items={alerts} />
            </div>
          </AlertsBell>
        ) : null}
      </div>
    </div>
  );
}

/** 08.7-12 RED stub (inert): the owner's bell on the overview answer's alerts. */
export async function OwnerBell(_props: {
  alerts: readonly OwnerAlert[];
  timeZone: string;
}): Promise<ReactNode> {
  return null;
}
