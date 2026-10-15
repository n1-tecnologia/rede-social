import { type OwnerBandScope, tenantOwnerPanel } from '@rede-social/module-dashboard/fixtures';
import {
  ActionCard,
  BarList,
  CohortHeatmap,
  CountUp,
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
import { getTranslations } from 'next-intl/server';
import {
  OWNER_BANDS_ANCHOR,
  type OwnerMembersView,
  ownerInsightAnchor,
  ownerListScope,
  ownerMembersHref,
} from '@/lib/owner-band-scope';
import { BandMembers } from './BandMembers';
import {
  bandLabel,
  changeDelta,
  formatCount,
  formatMonthAbbrev,
  formatPercent,
  formatSignedCount,
  kpiDelta,
} from './format';
import { OwnerMemberDetail } from './OwnerMemberDetail';
import { OwnerMemberList } from './OwnerMemberList';
import { SPAN_ALL } from './ownerGrid';
import { DisabledAction, PanelSection } from './PanelSection';

const SCOPE_TABS = [
  { kind: 'member', labelKey: 'tenantOwner.bandScope.byMember' },
  { kind: 'community', labelKey: 'tenantOwner.bandScope.byCommunity' },
  { kind: 'event', labelKey: 'tenantOwner.bandScope.byEvent' },
] as const satisfies readonly { kind: OwnerBandScope['kind']; labelKey: string }[];

/** Half of a four-column row (from 100rem), one cell at two columns. */
const HALF_AT_FOUR = '@min-[100rem]:col-span-2';

/**
 * The em risco and their push reach for the win-back card (quick 261012-tru D-08): the opened
 * community or event, else the whole base. A missing entry is a fixture bug, so it fails loud.
 */
function recoverReach(view: OwnerMembersView): { atRisk: number; withPush: number } {
  const scope = ownerListScope(view);
  const { engagement, atRiskWithPush, communityEngagement, eventEngagement } = tenantOwnerPanel;
  if (!scope || scope.kind === 'member') {
    return { atRisk: engagement.counts.at_risk, withPush: atRiskWithPush };
  }
  const rows = scope.kind === 'community' ? communityEngagement : eventEngagement;
  const entry = rows.find((row) => row.id === scope.id);
  if (!entry) throw new Error(`no engagement bands for ${scope.kind} ${scope.id}`);
  return { atRisk: entry.bands.counts.at_risk, withPush: entry.atRiskWithPush };
}

/**
 * Level 4, "Membros", on the member report's grid and card rules: growth across the top (who joined,
 * with the new members per week beside it as the report's usage card, and who left and the balance
 * next to it), the engagement bands across the width with the card to win back the members in risk
 * under them, then who changed band (up, down, the largest moves) and retention by joining month
 * (one number on a phone, the cohort heatmap from `@3xl`). Numbers and labels only, no notes.
 *
 * The bands are one cascade in three tabs (quick 261012-tru D-01): Por membro, Por comunidade and
 * Por evento, one row and nothing else to pick. Every tab shows the whole base's six bands, each
 * member counted once (D-02); a band opens its members (Por membro) or the community or event cards
 * (the others), a card opens its members in the band (D-05), and a member card opens that member's
 * insights in place of the area (D-06). Who moved stays whole-base; the win-back card follows the
 * opened community or event (D-08). Each insight number opens the list behind it (D-07). Those
 * lists and insights are the only places this panel names a member, to the client's own team
 * (261012-pkd D-03); every other block is counts only.
 */
export async function OwnerMembers({ members }: { members: OwnerMembersView }) {
  const t = await getTranslations('dashboard');
  if (members.memberId) {
    const { memberId, list, band } = members;
    if (list) {
      return (
        <OwnerMemberList
          t={t}
          memberId={memberId}
          list={list}
          backHref={`${ownerMembersHref({ ...members, list: null })}#${ownerInsightAnchor(list)}`}
        />
      );
    }
    // The parser only lets a member through with the band they hold in the opened list (R-5, D-06).
    const scope = ownerListScope(members);
    if (!band || !scope) throw new Error(`member ${memberId} opened with no band or list`);
    return (
      <OwnerMemberDetail
        t={t}
        memberId={memberId}
        band={band}
        scope={scope}
        backHref={ownerMembersHref({ ...members, memberId: null, list: null })}
        listHref={(slug) => ownerMembersHref({ ...members, list: slug })}
      />
    );
  }
  const { kpis, growth, cohorts, movement, engagement } = tenantOwnerPanel;
  const recover = recoverReach(members);
  const balance = growth.joined - growth.left;
  const balanceDelta = changeDelta(kpis.members.count, kpis.members.count - balance);
  const latest = cohorts.at(-1);
  const latestMonthOne = latest?.values[1];
  const columnCount = Math.max(0, ...cohorts.map((c) => c.values.length));
  const flows = [...movement.flows].sort((a, b) => b.members - a.members);

  return (
    <>
      <PanelSection title={t('tenantOwner.growth.title')} className={SPAN_ALL}>
        {/* The joined card reads across like the report's usage card, its weekly chart beside the
            number at a fixed height; who left and the balance stand next to it on the web. */}
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
              icon={UserMinus}
              label={t('tenantOwner.growth.left')}
              value={formatCount(growth.left)}
            />
            <KpiCard
              icon={Scale}
              label={t('tenantOwner.growth.net')}
              value={formatSignedCount(balance)}
              delta={balanceDelta ? kpiDelta(t, balanceDelta) : undefined}
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
        <nav aria-label={t('tenantOwner.bandScope.label')}>
          {/* Three equal tabs spanning the bar, as the area tabs; the only row (D-01). */}
          <ul className="grid grid-cols-3 gap-2">
            {SCOPE_TABS.map((tab) => (
              <li key={tab.kind} className="min-w-0">
                <Chip
                  href={ownerMembersHref({
                    kind: tab.kind,
                    band: null,
                    itemId: null,
                    memberId: null,
                    list: null,
                  })}
                  active={tab.kind === members.kind}
                  className="w-full justify-center text-center"
                >
                  {t(tab.labelKey)}
                </Chip>
              </li>
            ))}
          </ul>
        </nav>
        <div data-dash-stagger className="flex flex-col gap-3">
          <BandMembers t={t} bands={engagement} view={members} />
        </div>
        <ActionCard
          icon={HeartHandshake}
          title={t('tenantOwner.recover.title')}
          detail={t('tenantOwner.recover.detail', {
            atRisk: formatCount(recover.atRisk),
            withPush: formatCount(recover.withPush),
          })}
          action={
            <DisabledAction variant="outline">{t('tenantOwner.recover.action')}</DisabledAction>
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
          {/* Stacked: a move's two band names fit on one line over its bar, even at 360 px. */}
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
        </div>
      </PanelSection>

      <PanelSection title={t('tenantOwner.retention.title')} className={HALF_AT_FOUR}>
        {latest && latestMonthOne !== undefined ? (
          <div className="@3xl:hidden">
            <KpiCard
              icon={Repeat}
              label={t('tenantOwner.retention.phoneLabel')}
              value={formatPercent(latestMonthOne)}
            />
          </div>
        ) : null}
        {/* On the web the heatmap's card fills its cell and centers the table, so it lines up with
            the cell beside it. */}
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
      </PanelSection>
    </>
  );
}
