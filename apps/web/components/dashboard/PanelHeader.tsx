import type { OwnerAlert } from '@rede-social/module-dashboard/contracts';
import { type LabelTone, SURFACE, ToneLabel } from '@rede-social/module-dashboard/ui';
import { Card, cn, SectionTitle } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { localDate, localMoment } from '@/lib/owner-list-view';
import { AlertsBell } from './AlertsBell';
import { type DashboardT, formatCount, formatDayMonth } from './format';
import { DisabledAction } from './PanelSection';
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
  /**
   * The bell, on the right after the period (08.7-12, UI-D-482): the host streams it in its own
   * `Suspense` with nothing in its place while it loads, so the header renders at once.
   */
  bell?: ReactNode;
  /** Placement in the host's layout. */
  className?: string;
}

/**
 * The panel's top bar (the reference's app bar, without its device frame): the tenant's mark (its
 * app icon, else a brand-filled initial), the title and a subtitle, and on the right the period and,
 * when the host passes one, the bell whose list opens under the header.
 */
export function PanelHeader({
  title,
  iconUrl = null,
  subtitle,
  period,
  bell,
  className,
}: PanelHeaderProps) {
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
        {bell}
      </div>
    </div>
  );
}

/** One row of the bell: the shipped attention row, optionally a link and an action under it. */
interface BellRow {
  id: string;
  tone: LabelTone;
  tag: string;
  title: string;
  detail?: string;
  /** The screen the alert opens (D-461: only a destination that already exists). */
  href?: string;
  /** A disabled action with its "Em breve" pill (UI-D-478). */
  action?: ReactNode;
}

/** "24/10, 19h30": an event's start in the tenant's zone (the Eventos card's own form). */
function startText(t: DashboardT, startsAt: string, timeZone: string): string {
  const [hour = '0', minutes = '00'] = localMoment(
    startsAt,
    timeZone,
    Date.parse(startsAt),
  ).time.split(':');
  return t('tenantOwner.alerts.event_soon.tag', {
    date: formatDayMonth(localDate(startsAt, timeZone)),
    hour: Number(hour),
    minutes: minutes === '00' ? 'none' : minutes,
  });
}

/**
 * The API's alert as a bell row (08.7-12, D-459, D-461, UI-D-480, UI-D-489 a/d): the support queue
 * at the last update (urgent), the next nearly full event opening its attendee list, and the members
 * who entered "em risco" with their push reach and the disabled "Enviar push" only while
 * `notifications` is on (the API leaves `withPush` out otherwise).
 */
function bellRow(t: DashboardT, alert: OwnerAlert, timeZone: string): BellRow {
  const base = `tenantOwner.alerts.${alert.kind}`;
  switch (alert.kind) {
    case 'support_waiting':
      return {
        id: alert.kind,
        tone: 'danger',
        tag: t(`${base}.tag`, { hours: alert.oldestHours }),
        title: t(`${base}.title`, { count: alert.conversations }),
        detail: t(`${base}.detail`, { hours: alert.oldestHours }),
      };
    case 'event_soon':
      return {
        id: alert.kind,
        tone: 'warning',
        tag: startText(t, alert.startsAt, timeZone),
        title: t(`${base}.title`, {
          event: alert.title,
          confirmed: formatCount(alert.confirmed),
          capacity: formatCount(alert.capacity),
        }),
        detail: t(`${base}.detail`, { left: alert.capacity - alert.confirmed }),
        href: `/eventos/${alert.eventId}/participantes`,
      };
    default:
      return {
        id: alert.kind,
        tone: 'warning',
        tag: t(`${base}.tag`),
        title: t(`${base}.title`, { count: alert.members }),
        ...(alert.withPush === undefined
          ? {}
          : {
              detail: t(`${base}.detail`, { count: formatCount(alert.withPush) }),
              action: (
                <DisabledAction variant="outline" pill={t('report.comingSoon.value')}>
                  {t(`${base}.action`)}
                </DisabledAction>
              ),
            }),
      };
  }
}

/** The bell's list: the shipped `AttentionList` look, a row that opens a screen being a link. */
function BellRowList({ rows }: { rows: readonly BellRow[] }) {
  return (
    <Card className={SURFACE}>
      <ul className="divide-y divide-divider">
        {rows.map((row) => {
          const body = (
            <>
              <ToneLabel tone={row.tone} className="shrink-0">
                {row.tag}
              </ToneLabel>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
                <span className="text-sm font-bold text-text">{row.title}</span>
                {row.detail ? (
                  <span className="text-xs text-text-secondary">{row.detail}</span>
                ) : null}
                {row.action ? <div className="pt-1.5">{row.action}</div> : null}
              </div>
            </>
          );
          return (
            <li key={row.id} data-alert={row.id}>
              {row.href ? (
                <a
                  href={row.href}
                  className="flex items-start gap-3 rounded-2xl p-4 hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {body}
                </a>
              ) : (
                <div className="flex items-start gap-3 p-4">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export interface OwnerBellProps {
  /** `alerts` of the ready overview answer (`GET /v1/dashboard/owner/overview`). */
  alerts: readonly OwnerAlert[];
  /** `bootstrap.tenant.timezone`: an event's start is the tenant's. */
  timeZone: string;
}

/**
 * The owner's bell on the API's alerts (08.7-12, D-459): absent when no alert is left (UI-D-472),
 * a ringing bell when the support queue waits (danger), its list opening under the header.
 */
export async function OwnerBell({ alerts, timeZone }: OwnerBellProps): Promise<ReactNode> {
  if (alerts.length === 0) return null;
  const t = await getTranslations('dashboard');
  const rows = alerts.map((alert) => bellRow(t, alert, timeZone));
  const count = rows.length;
  const urgent = rows.filter((row) => row.tone === 'danger').length;
  return (
    <AlertsBell
      label={
        urgent > 0 ? t('alerts.buttonUrgent', { count, urgent }) : t('alerts.button', { count })
      }
      closeLabel={t('alerts.close')}
      count={count}
      urgent={urgent > 0}
    >
      <div className="flex flex-col gap-3">
        <SectionTitle as="h3" variant="group">
          {t('alerts.title', { count })}
        </SectionTitle>
        <BellRowList rows={rows} />
      </div>
    </AlertsBell>
  );
}
