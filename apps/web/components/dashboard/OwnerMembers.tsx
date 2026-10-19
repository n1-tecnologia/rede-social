import type { EventEngagement, OwnerMembersReady } from '@rede-social/module-dashboard/contracts';
import { OWNER_BAND_PAGE_SIZE } from '@rede-social/module-dashboard/contracts';
import {
  ActionCard,
  BarList,
  CohortHeatmap,
  CountUp,
  ENGAGEMENT_BAND_ORDER,
  KpiCard,
  KpiGrid,
  LineChart,
  percentOf,
} from '@rede-social/module-dashboard/ui';
import { Chip, cn } from '@rede-social/ui';
import {
  HeartHandshake,
  Repeat,
  Scale,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getOwnerBandMembers, getOwnerMembers } from '@/lib/dashboard';
import { freshnessText } from '@/lib/dashboard-view';
import {
  type EngagementBand,
  OWNER_BANDS_ANCHOR,
  type OwnerMembersKind,
  type OwnerMembersView,
  ownerBandListParams,
  ownerListScope,
  ownerMembersHref,
} from '@/lib/owner-band-scope';
import { bandMemberRowView } from '@/lib/owner-list-view';
import { OWNER_PANEL_ANCHOR, type OwnerPanelFlags } from '@/lib/owner-panel';
import { type BandListView, BandMembers } from './BandMembers';
import {
  bandLabel,
  type DashboardT,
  formatCount,
  formatMonthAbbrev,
  formatPercent,
} from './format';
import { OwnerAreaState } from './OwnerAreaState';
import { SPAN_ALL } from './ownerGrid';
import { DisabledAction, PanelSection } from './PanelSection';
import { SnapshotFreshness } from './SnapshotFreshness';

const SCOPE_TABS = [
  { kind: 'member', labelKey: 'tenantOwner.bandScope.byMember' },
  { kind: 'community', labelKey: 'tenantOwner.bandScope.byCommunity' },
  { kind: 'event', labelKey: 'tenantOwner.bandScope.byEvent' },
] as const satisfies readonly { kind: OwnerMembersKind; labelKey: string }[];

/** The scope row's columns per tab count (UI-D-471): two share it equally, one hides the row. */
const SCOPE_COLUMNS: Record<number, string> = { 2: 'grid-cols-2', 3: 'grid-cols-3' };

/** Half of a four-column row (from 100rem), one cell at two columns. */
const HALF_AT_FOUR = '@min-[100rem]:col-span-2';

export interface OwnerMembersProps {
  /** The Membros view (syntactic, `parseOwnerMembersView`). */
  members: OwnerMembersView;
  /** The panel's module flags (`ownerPanelFlags`, read once on `/perfil`). */
  flags: OwnerPanelFlags;
  /** `bootstrap.tenant.timezone`: the freshness line and the dates are the tenant's. */
  timeZone: string;
}

/** The tabs of the scope row, minus those whose module is off (D-460, UI-D-471). */
function scopeTabs(flags: OwnerPanelFlags) {
  return SCOPE_TABS.filter(
    (tab) =>
      tab.kind === 'member' ||
      (tab.kind === 'community' && flags.communities) ||
      (tab.kind === 'event' && flags.events),
  );
}

/** Upcoming events soonest first, then past ones most recent first (quick 261012-qer B-2). */
function panelEventOrder(events: readonly EventEngagement[], untilAt: string): EventEngagement[] {
  const until = Date.parse(untilAt);
  const upcoming = events
    .filter((event) => Date.parse(event.startsAt) >= until)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const past = events
    .filter((event) => Date.parse(event.startsAt) < until)
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  return [...upcoming, ...past];
}

/**
 * The em risco and their push reach for the win-back card (quick 261012-tru D-08): the opened
 * community or event, else the whole base. An opened id the answer does not hold reads the base.
 */
function recoverReach(
  answer: OwnerMembersReady,
  view: OwnerMembersView,
): { atRisk: number; withPush: number } {
  const scope = ownerListScope(view);
  const base = { atRisk: answer.engagement.counts.at_risk, withPush: answer.atRiskWithPush };
  if (!scope || scope.kind === 'member') return base;
  const rows =
    scope.kind === 'community'
      ? (answer.communityEngagement ?? [])
      : (answer.eventEngagement ?? []);
  const entry = rows.find((row) => row.id === scope.id);
  return entry ? { atRisk: entry.bands.counts.at_risk, withPush: entry.atRiskWithPush } : base;
}

/** The URL of the screen with the panel's anchor: "Tentar novamente" reloads it (UI-D-479). */
function retryHref(view: OwnerMembersView): string {
  return `${ownerMembersHref(view).split('#')[0]}#${OWNER_PANEL_ANCHOR}`;
}

/**
 * The first page of each band list the view shows (08.7-05): in Por membro every band with members
 * (a closed `<details>` opens without a request, so its list is already there); with a community or
 * an event opened, the open band in it. `notFound` (an id the API does not know for this tenant, or
 * a scope whose module went off) is `null`: the view falls one level up (D-06).
 */
async function readBandLists(
  t: DashboardT,
  answer: OwnerMembersReady,
  view: OwnerMembersView,
  timeZone: string,
  nowMs: number,
): Promise<Partial<Record<EngagementBand, BandListView>> | null> {
  let bands: EngagementBand[] = [];
  if (view.kind === 'member') {
    bands = ENGAGEMENT_BAND_ORDER.filter((band) => answer.engagement.counts[band] > 0);
  } else if (view.band && view.itemId !== null) {
    bands = [view.band];
  }
  const lists: Partial<Record<EngagementBand, BandListView>> = {};
  let notFound = false;
  await Promise.all(
    bands.map(async (band) => {
      const params = ownerBandListParams(view, band);
      if (!params) return;
      const read = await getOwnerBandMembers({ ...params, limit: OWNER_BAND_PAGE_SIZE });
      if (read.status === 'redirect') redirect(read.path);
      if (read.status === 'notFound') {
        notFound = true;
        return;
      }
      if (read.status === 'error' || read.answer.state === 'preparing') {
        lists[band] = { status: 'error' };
        return;
      }
      lists[band] = {
        status: 'ready',
        total: read.answer.total,
        nextCursor: read.answer.nextCursor,
        rows: read.answer.rows.map((row) =>
          bandMemberRowView(t, row, { view, band, timeZone, nowMs }),
        ),
      };
    }),
  );
  return notFound ? null : lists;
}

/**
 * Level 4, "Membros", on the snapshot (08.7-05, INSIGHT-08, D-465): the freshness line first, then
 * growth across the top (who joined, with the new members per week beside it, and "Saíram" and
 * "Saldo" as "Em breve" tiles: no leave is recorded yet), the engagement bands across the width with
 * the card to win back the members in risk under them, then who changed band (up, down, the largest
 * moves) and retention by joining month (one number on a phone, the cohort heatmap from `@3xl`).
 *
 * The bands are one cascade in the scope tabs (quick 261012-tru D-01): Por membro, and Por comunidade
 * and Por evento only with their modules on (D-460, UI-D-471). Every tab shows the whole base's six
 * bands, each member counted once (D-02); a band opens its members (Por membro) or the community or
 * event cards, a card opens its members in the band (D-05), and a member card opens that member's
 * detail (D-06, D-461). Who moved stays whole-base; the win-back card follows the opened community
 * or event (D-08), and its action stays disabled with the "Em breve" pill (UI-D-478, PR-4).
 */
export async function OwnerMembers({ members: view, flags, timeZone }: OwnerMembersProps) {
  const [t, result] = await Promise.all([getTranslations('dashboard'), getOwnerMembers()]);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'error') return <OwnerAreaState kind="error" retryHref={retryHref(view)} />;
  if (result.answer.state === 'preparing') return <OwnerAreaState kind="preparing" scope="area" />;
  const answer = result.answer;
  const nowMs = Date.now();

  // The member level is wired by Task 2 of 08.7-05; until then it shows the area.
  let bandView: OwnerMembersView = { ...view, memberId: null, list: null };
  let lists = await readBandLists(t, answer, bandView, timeZone, nowMs);
  if (lists === null) {
    // An opened community or event the API does not know: the band's cards (D-06).
    bandView = { ...bandView, itemId: null };
    lists = {};
  }

  const freshness = freshnessText(answer.snapshot, timeZone, nowMs);
  const { growth, engagement, movement, cohorts } = answer;
  const communities = flags.communities ? (answer.communityEngagement ?? []) : [];
  const events = flags.events
    ? panelEventOrder(answer.eventEngagement ?? [], answer.snapshot.windows.untilAt)
    : [];
  const recover = recoverReach(answer, bandView);
  const latest = cohorts.at(-1);
  const latestMonthOne = latest?.values[1];
  const columnCount = Math.max(0, ...cohorts.map((c) => c.values.length));
  const flows = [...movement.flows].sort((a, b) => b.members - a.members);
  const tabs = scopeTabs(flags);
  const comingSoon = t('report.comingSoon.value');
  const comingSoonNote = t('report.comingSoon.note');

  return (
    <>
      <SnapshotFreshness text={t(`report.freshness.${freshness.key}`, { ...freshness.values })} />

      <PanelSection title={t('tenantOwner.growth.title')} className={SPAN_ALL}>
        {/* The joined card reads across like the report's usage card, its weekly chart beside the
            number at a fixed height; who left and the balance stand next to it on the web, "Em
            breve" until a leave is recorded (D-465). */}
        <div className="flex flex-col gap-3 @4xl:grid @4xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] @4xl:items-stretch">
          <KpiCard
            icon={UserPlus}
            label={t('tenantOwner.growth.joined')}
            value={formatCount(growth.joined)}
            chartPlacement="side"
            chart={
              <LineChart
                series={growth.weeklyJoined}
                xLabels={growth.weeklyJoined.map((_, i) =>
                  (i + 1) % 4 === 0 ? t('tenantOwner.weekly.week', { week: i + 1 }) : '',
                )}
                yStep={5}
                formatValue={formatCount}
                ariaLabel={t('tenantOwner.growth.weeklyLabel')}
                height={150}
              />
            }
            footer={
              <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-text-secondary">
                <Sparkles aria-hidden size={14} className="shrink-0 text-brand" />
                <span>
                  <CountUp
                    value={t('tenantOwner.growth.activated', {
                      activated: formatCount(engagement.newActivated),
                      total: formatCount(engagement.counts.new),
                      percent: formatPercent(
                        percentOf(engagement.newActivated, engagement.counts.new),
                      ),
                    })}
                  />
                </span>
              </p>
            }
          />
          <KpiGrid className="@4xl:grid-cols-1">
            <KpiCard
              variant="missing"
              icon={UserMinus}
              label={t('tenantOwner.growth.left')}
              value={comingSoon}
              note={comingSoonNote}
            />
            <KpiCard
              variant="missing"
              icon={Scale}
              label={t('tenantOwner.growth.net')}
              value={comingSoon}
              note={comingSoonNote}
            />
          </KpiGrid>
        </div>
      </PanelSection>

      {/* scroll-mt keeps the #faixas landing clear of the app's fixed TopBar. */}
      <PanelSection
        id={OWNER_BANDS_ANCHOR}
        title={t('bands.title')}
        className={cn(SPAN_ALL, 'scroll-mt-20')}
      >
        {tabs.length > 1 ? (
          <nav aria-label={t('tenantOwner.bandScope.label')}>
            {/* Equal tabs spanning the bar, as the area tabs; the only row (D-01, UI-D-471). */}
            <ul className={cn('grid gap-2', SCOPE_COLUMNS[tabs.length])}>
              {tabs.map((tab) => (
                <li key={tab.kind} className="min-w-0">
                  <Chip
                    href={ownerMembersHref({
                      kind: tab.kind,
                      band: null,
                      itemId: null,
                      memberId: null,
                      list: null,
                    })}
                    active={tab.kind === bandView.kind}
                    className="w-full justify-center text-center"
                  >
                    {t(tab.labelKey)}
                  </Chip>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <div data-dash-stagger className="flex flex-col gap-3">
          <BandMembers
            t={t}
            bands={engagement}
            view={bandView}
            lists={lists}
            communities={communities}
            events={events}
            timeZone={timeZone}
          />
        </div>
        <ActionCard
          icon={HeartHandshake}
          title={t('tenantOwner.recover.title')}
          detail={
            flags.notifications
              ? t('tenantOwner.recover.detail', {
                  atRisk: formatCount(recover.atRisk),
                  withPush: formatCount(recover.withPush),
                })
              : t('tenantOwner.recover.detailNoPush', { atRisk: formatCount(recover.atRisk) })
          }
          action={
            <DisabledAction variant="outline" pill={comingSoon}>
              {t('tenantOwner.recover.action')}
            </DisabledAction>
          }
        />
      </PanelSection>

      <PanelSection title={t('tenantOwner.movement.title')} className={HALF_AT_FOUR}>
        <div className="flex flex-col gap-3 @4xl:flex-1">
          <KpiGrid className="@4xl:grid-cols-2">
            <KpiCard
              icon={TrendingUp}
              label={t('tenantOwner.movement.up')}
              value={formatCount(movement.up)}
            />
            <KpiCard
              icon={TrendingDown}
              label={t('tenantOwner.movement.down')}
              value={formatCount(movement.down)}
            />
          </KpiGrid>
          {flows.length === 0 ? (
            <p data-owner-empty="movement" className="text-xs font-normal text-text-secondary">
              {t('tenantOwner.movement.empty')}
            </p>
          ) : (
            // Stacked: a move's two band names fit on one line over its bar, even at 360 px.
            <BarList
              stacked
              className="@4xl:flex @4xl:flex-1 @4xl:flex-col @4xl:justify-center"
              rows={flows.map((flow) => ({
                id: `${flow.from}-${flow.to}`,
                label: t('bands.flow', {
                  from: bandLabel(t, flow.from),
                  to: bandLabel(t, flow.to),
                }),
                value: flow.members,
                display: formatCount(flow.members),
                highlight: flow.to === 'at_risk',
              }))}
            />
          )}
        </div>
      </PanelSection>

      <PanelSection title={t('tenantOwner.retention.title')} className={HALF_AT_FOUR}>
        {cohorts.length === 0 ? (
          <p data-owner-empty="retention" className="text-xs font-normal text-text-secondary">
            {t('tenantOwner.retention.empty')}
          </p>
        ) : (
          <>
            {latest && latestMonthOne !== undefined ? (
              <div className="@3xl:hidden">
                <KpiCard
                  icon={Repeat}
                  label={t('tenantOwner.retention.phoneLabel')}
                  value={formatPercent(latestMonthOne)}
                />
              </div>
            ) : null}
            {/* On the web the heatmap's card fills its cell and centers the table, so it lines up
                with the cell beside it. */}
            <div className="hidden @3xl:flex @3xl:flex-col @4xl:flex-1 @4xl:[&>*]:flex @4xl:[&>*]:flex-1 @4xl:[&>*]:items-center">
              <CohortHeatmap
                caption={t('tenantOwner.retention.title')}
                corner={t('tenantOwner.retention.corner')}
                columns={Array.from({ length: columnCount }, (_, n) =>
                  t('tenantOwner.retention.column', { n }),
                )}
                rows={cohorts.map((cohort) => ({
                  label: formatMonthAbbrev(cohort.month),
                  values: cohort.values,
                }))}
                formatValue={formatPercent}
              />
            </div>
          </>
        )}
      </PanelSection>
    </>
  );
}
