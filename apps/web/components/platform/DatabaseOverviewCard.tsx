import { type DatabaseOverview, PROJECT_REF_PATTERN } from '@rede-social/contracts/projects';
import { Card, SectionTitle } from '@rede-social/ui';
import { CircleAlert, ExternalLink, Info, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DatabasePill } from './DatabasePill';
import { VerifyDatabaseButton, type VerifyDatabaseButtonProps } from './VerifyDatabaseButton';

export interface DatabaseOverviewCardProps {
  tenantId: string;
  overview: DatabaseOverview;
  /** "há 3 min" - computed on the server with `relativeFrom`; null when the project was never checked. */
  verifiedWhen: string | null;
  /** `verifyDatabaseAction`, handed down by the page (the card knows no route and no API). */
  verifyAction: VerifyDatabaseButtonProps['action'];
}

/** What a state's notice row looks like: its catalog key, its tone and whether it is an alert (UI-D-539). */
const NOTICES = {
  behind: { key: 'behind', tone: 'warning' },
  paused: { key: 'paused', tone: 'warning' },
  unreachable: { key: 'unreachable', tone: 'danger' },
  preparation_failed: { key: 'preparationFailed', tone: 'danger' },
  moving: { key: 'moving', tone: 'neutral' },
} as const;

type NoticeState = keyof typeof NOTICES;

function hasNotice(state: DatabaseOverview['state']): state is NoticeState {
  return state in NOTICES;
}

/** The plan is information only (A-UI-9): a closed set of words, never the provider's own text. */
function planKey(plan: string | null): 'planPro' | 'planFree' | 'planUnknown' {
  const value = plan?.trim().toLowerCase();
  if (value === 'pro') return 'planPro';
  if (value === 'free') return 'planFree';
  return 'planUnknown';
}

/** The project is being prepared: there is nothing to check yet (UI-D-536). */
function isPreparing(overview: DatabaseOverview): boolean {
  return (
    overview.state === 'preparing' ||
    overview.state === 'preparation_failed' ||
    overview.steps.some((step) => step.status === 'running')
  );
}

/**
 * The overview card of the Banco tab (09.2-19, UI-D-536, UI-D-539): whether the tenant's database is
 * up (the pill and when it was last checked), what it is (project, schema, plan and, outside
 * production, who else shares it) and where it is behind (the notice row of the state). A Server
 * Component; the only interactive part is the "Verificar agora" island.
 *
 * Everything here is React text. The dashboard link is built from the stored ref ONLY when it is
 * exactly twenty lower-case letters, `^[a-z]{20}$` (UI-D-548) and opens a new tab with `noopener noreferrer`; the
 * columns are `minmax(0, …)` and the ref is `break-all`, so the card never scrolls sideways at 320px.
 * No credential, pooler URL, SQL, host or provider text can reach it: the answer's schema has no such
 * field and the notices are catalog sentences chosen by state.
 */
export function DatabaseOverviewCard({
  tenantId,
  overview,
  verifiedWhen,
  verifyAction,
}: DatabaseOverviewCardProps) {
  const t = useTranslations('platform.database');
  const { schema } = overview;

  const schemaText =
    schema.applied !== null && schema.required !== null && schema.applied < schema.required
      ? t('overview.schemaOf', { applied: schema.applied, required: schema.required })
      : schema.applied !== null
        ? String(schema.applied)
        : schema.required !== null &&
            (overview.state === 'preparing' || overview.state === 'preparation_failed')
          ? t('overview.schemaOf', { applied: 0, required: schema.required })
          : t('overview.schemaUnknown');

  const dashboardRef = PROJECT_REF_PATTERN.test(overview.ref) ? overview.ref : null;
  const notice = hasNotice(overview.state) ? NOTICES[overview.state] : null;

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-6">
      <SectionTitle variant="micro">{t('overview.title')}</SectionTitle>

      <div className="flex flex-wrap items-center gap-3">
        <DatabasePill state={overview.state} />
        <span className="text-xs text-text-tertiary">
          {verifiedWhen
            ? t('overview.verifiedAt', { when: verifiedWhen })
            : t('overview.neverChecked')}
        </span>
      </div>

      <dl className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-text-tertiary">{t('overview.project')}</dt>
        <dd className="m-0 flex min-w-0 flex-col gap-1 text-text">
          <span className="break-all tabular-nums">{overview.ref}</span>
          {dashboardRef ? (
            <a
              href={`https://supabase.com/dashboard/project/${dashboardRef}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-center gap-1 self-start text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {t('overview.openInSupabase')}
              <ExternalLink aria-hidden size={14} />
              <span className="sr-only">{t('overview.newTab')}</span>
            </a>
          ) : null}
        </dd>

        <dt className="text-text-tertiary">{t('overview.schema')}</dt>
        <dd className="m-0 min-w-0 break-words tabular-nums text-text">{schemaText}</dd>

        <dt className="text-text-tertiary">{t('overview.plan')}</dt>
        <dd className="m-0 min-w-0 break-words text-text">
          {t(`overview.${planKey(overview.plan)}`)}
        </dd>

        {overview.otherTenants > 0 ? (
          <>
            <dt className="text-text-tertiary">{t('overview.shared')}</dt>
            <dd className="m-0 min-w-0 break-words text-text">
              {t('overview.sharedBody', { n: overview.otherTenants })}
            </dd>
          </>
        ) : null}
      </dl>

      {notice ? (
        <div
          role={notice.tone === 'danger' ? 'alert' : undefined}
          data-notice={notice.key}
          className={
            notice.tone === 'danger'
              ? 'flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/5 px-3 py-3'
              : notice.tone === 'warning'
                ? 'flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-3'
                : 'flex items-start gap-2 rounded-xl bg-bg-tertiary px-3 py-3'
          }
        >
          {notice.tone === 'danger' ? (
            <TriangleAlert aria-hidden size={16} className="mt-0.5 shrink-0 text-danger" />
          ) : notice.tone === 'warning' ? (
            <CircleAlert aria-hidden size={16} className="mt-0.5 shrink-0 text-warning" />
          ) : (
            <Info aria-hidden size={16} className="mt-0.5 shrink-0 text-text-secondary" />
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <p className="break-words text-xs text-text">{t(`notices.${notice.key}`)}</p>
            {overview.lastErrorCode ? (
              <p className="break-words text-xs text-text-tertiary">
                {t('notices.code', { code: overview.lastErrorCode })}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div>
        <VerifyDatabaseButton
          tenantId={tenantId}
          disabled={isPreparing(overview)}
          action={verifyAction}
        />
      </div>
    </Card>
  );
}
