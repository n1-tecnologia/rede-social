import type { OwnerContentReady } from '@rede-social/module-dashboard/contracts';
import { CountUp } from '@rede-social/module-dashboard/ui';
import { Chip, cn } from '@rede-social/ui';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { getOwnerContent } from '@/lib/dashboard';
import { freshnessText } from '@/lib/dashboard-view';
import { contentCommunityNames, contentPosts } from '@/lib/owner-content-rows';
import {
  type ContentTab,
  contentBackHref,
  contentTabView,
  type OwnerContentView,
  ownerContentHref,
} from '@/lib/owner-content-view';
import { OWNER_PANEL_ANCHOR, type OwnerPanelFlags } from '@/lib/owner-panel';
import { BackLink } from './BackLink';
import { type DashboardT, formatCount } from './format';
import { OwnerAreaSkeleton } from './OwnerAreaSkeleton';
import { OwnerAreaState } from './OwnerAreaState';
import { OwnerContentOverview } from './OwnerContentOverview';
import { ContentInteractions, OwnerContentPeople } from './OwnerContentPeople';
import { ContentPostList } from './OwnerContentPostCard';
import { OwnerContentPostDetail } from './OwnerContentPostDetail';
import { OwnerContentReplies } from './OwnerContentReplies';
import { OwnerContentTypes } from './OwnerContentTypes';
import { OwnerMemberDetail } from './OwnerMemberDetail';
import { OwnerMemberList } from './OwnerMemberList';
import { SPAN_ALL } from './ownerGrid';
import { PanelSection } from './PanelSection';
import { SnapshotFreshness } from './SnapshotFreshness';

const KEY = 'tenantOwner.content';

const TABS = [
  { tab: 'overview', labelKey: `${KEY}.tabs.overview` },
  { tab: 'types', labelKey: `${KEY}.tabs.types` },
  { tab: 'posts', labelKey: `${KEY}.tabs.posts` },
] as const satisfies readonly { tab: ContentTab; labelKey: string }[];

/** The tab grid per tab count: three equal tabs; one tab hides the row (UI-D-471's rule). */
const TAB_COLUMNS: Record<number, string> = { 2: 'grid-cols-2', 3: 'grid-cols-3' };

export interface OwnerContentProps {
  /** The Conteúdo view (syntactic, `parseOwnerContentView`). */
  content: OwnerContentView;
  /** The panel's module flags (`ownerPanelFlags`, read once on `/perfil`). */
  flags: OwnerPanelFlags;
  /** `bootstrap.tenant.timezone`: the freshness line and the dates are the tenant's. */
  timeZone: string;
}

/** What every Conteúdo screen reads: the translator, the ready answer, the flags and the zone. */
interface ScreenProps {
  t: DashboardT;
  view: OwnerContentView;
  answer: OwnerContentReady;
  flags: OwnerPanelFlags;
  timeZone: string;
}

/** The URL of the screen with the panel's anchor: "Tentar novamente" reloads it (UI-D-479). */
function retryHref(view: OwnerContentView): string {
  return `${ownerContentHref(view)}#${OWNER_PANEL_ANCHOR}`;
}

/**
 * The one row of choices of the area (D-01): three equal tabs across it, as Membros' scope tabs.
 * Visão geral and Publicações are the feed's: with `feed` off only Por tipo is left, and the row
 * is absent (UI-D-473).
 */
function ContentTabs({ t, view, flags }: Pick<ScreenProps, 't' | 'view' | 'flags'>) {
  const tabs = TABS.filter((row) => row.tab === 'types' || flags.feed);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={t(`${KEY}.tabs.label`)} className={SPAN_ALL}>
      <ul className={cn('grid gap-2', TAB_COLUMNS[tabs.length])}>
        {tabs.map((row) => (
          <li key={row.tab} className="min-w-0">
            <Chip
              href={ownerContentHref(contentTabView(row.tab))}
              active={row.tab === view.tab}
              className="w-full justify-center text-center"
            >
              {t(row.labelKey)}
            </Chip>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Publicações (D-04): the window's feed posts best to worst across the area, each opening its detail. */
function PostsTab({ t, answer, flags, timeZone }: Omit<ScreenProps, 'view'>) {
  const count = contentPosts(answer).length;
  return (
    <PanelSection title={t(`${KEY}.posts.title`)} className={SPAN_ALL}>
      <p className="text-sm text-text-secondary">{t(`${KEY}.posts.order`, { count })}</p>
      <ContentPostList
        t={t}
        answer={answer}
        list="best"
        ctx={{ flags, communities: contentCommunityNames(answer, flags), timeZone }}
      />
    </PanelSection>
  );
}

/**
 * The list behind one overview number (D-02), a deeper step under its "Voltar", across the whole
 * area; its count line repeats the number. Publicações lists the posts newest first, Interações
 * every interaction (PD-7), most recent first, continued in place (UI-D-477).
 */
function ContentNumberList({ t, view, answer, flags, timeZone }: ScreenProps) {
  const back = contentBackHref(view);
  const { number } = view;
  if (!number || back === null) throw new Error('a number list with no number');
  const kpis = answer.kpis;
  const key = `${KEY}.numbers`;
  const count =
    number === 'posts'
      ? t(`${key}.posts`, { count: contentPosts(answer).length })
      : t(`${key}.interactions`, { value: formatCount(kpis?.interactions.current ?? 0) });
  return (
    <div className={cn('flex min-w-0 flex-col gap-3', SPAN_ALL)}>
      <BackLink href={back} label={t('tenantOwner.memberDetail.back')} />
      <PanelSection title={t(`${KEY}.overview.kpis.${number}`)} prominent>
        <p className="text-sm text-text-secondary">
          <CountUp value={count} />
        </p>
        {number === 'posts' ? (
          <ContentPostList
            t={t}
            answer={answer}
            list="newest"
            ctx={{ flags, communities: contentCommunityNames(answer, flags), timeZone }}
          />
        ) : (
          <Suspense fallback={<OwnerAreaSkeleton />}>
            <ContentInteractions view={view} answer={answer} timeZone={timeZone} />
          </Suspense>
        )}
      </PanelSection>
    </div>
  );
}

/** The area's screens with nothing opened below a tab: the tabs, then the tab's body. */
function ContentArea(props: ScreenProps) {
  const { t, view, answer, flags, timeZone } = props;
  if (view.number) return <ContentNumberList {...props} />;
  return (
    <>
      <ContentTabs t={t} view={view} flags={flags} />
      {view.tab === 'types' ? (
        <OwnerContentTypes t={t} answer={answer} view={view} flags={flags} timeZone={timeZone} />
      ) : null}
      {view.tab === 'posts' ? (
        <PostsTab t={t} answer={answer} flags={flags} timeZone={timeZone} />
      ) : null}
      {view.tab === 'overview' ? (
        <OwnerContentOverview t={t} answer={answer} view={view} flags={flags} timeZone={timeZone} />
      ) : null}
    </>
  );
}

/**
 * The screen a view asks for, deepest level first. Each deeper level streams in its own `Suspense`
 * behind `OwnerAreaSkeleton` (UI-D-482) and receives the level above as its fallback: an id the API
 * does not know for this tenant (its bare 404) renders that level instead (D-06).
 */
function ContentScreen(props: ScreenProps) {
  const { view, answer, flags, timeZone } = props;
  if (view.replies) {
    return (
      <Suspense fallback={<OwnerAreaSkeleton />}>
        <OwnerContentReplies view={view} answer={answer} timeZone={timeZone} />
      </Suspense>
    );
  }
  if (view.memberId) {
    const above = <ContentScreen {...props} view={{ ...view, memberId: null, list: null }} />;
    const back = contentBackHref(view);
    if (back === null) throw new Error('a member with no way back');
    return (
      <Suspense fallback={<OwnerAreaSkeleton />}>
        {view.list === null ? (
          <OwnerMemberDetail
            memberId={view.memberId}
            scopeKind="member"
            links={{
              back,
              list: (slug) => ownerContentHref({ ...view, list: slug }),
              retry: retryHref(view),
            }}
            flags={flags}
            timeZone={timeZone}
            fallback={above}
          />
        ) : (
          <OwnerMemberList
            memberId={view.memberId}
            list={view.list}
            links={{ back, retry: retryHref(view) }}
            timeZone={timeZone}
            fallback={above}
          />
        )}
      </Suspense>
    );
  }
  if (view.who && view.postId) {
    return (
      <Suspense fallback={<OwnerAreaSkeleton />}>
        <OwnerContentPeople
          view={{ ...view, postId: view.postId, who: view.who }}
          answer={answer}
          timeZone={timeZone}
          fallback={<ContentScreen {...props} view={{ ...view, who: null }} />}
        />
      </Suspense>
    );
  }
  if (view.postId) {
    return (
      <Suspense fallback={<OwnerAreaSkeleton />}>
        <OwnerContentPostDetail
          view={{ ...view, postId: view.postId }}
          answer={answer}
          flags={flags}
          timeZone={timeZone}
          fallback={<ContentScreen {...props} view={{ ...view, postId: null }} />}
        />
      </Suspense>
    );
  }
  return <ContentArea {...props} />;
}

/**
 * Level 4, "Conteúdo", on the snapshot (08.7-07, INSIGHT-10): one cascade of plain links, as
 * Membros (D-01). It reads `GET /v1/dashboard/owner/content` once, inside the area's own `Suspense`
 * (planning decision 2), and maps the answer — `preparing` to the preparing card (UI-D-469), a
 * failed read to the area's error card with "Tentar novamente" on the same screen (UI-D-479), a
 * session refusal to the bootstrap's navigation, `ready` to the freshness line and the screen. The
 * tab screens — Visão geral, Por tipo (an opened type included) and Publicações — carry the row of
 * tabs; every deeper step (an overview number's list, a publication, who did one of its numbers, a
 * member, the list behind one of the member's numbers, the comments waiting for the team) replaces
 * the area under its "Voltar" (PD-3). The period is the snapshot's 30 days against the 30 before.
 */
export async function OwnerContent({ content: view, flags, timeZone }: OwnerContentProps) {
  const [t, result] = await Promise.all([getTranslations('dashboard'), getOwnerContent()]);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'error') return <OwnerAreaState kind="error" retryHref={retryHref(view)} />;
  if (result.answer.state === 'preparing') return <OwnerAreaState kind="preparing" scope="area" />;
  const answer = result.answer;
  const freshness = freshnessText(answer.snapshot, timeZone, Date.now());
  return (
    <>
      <SnapshotFreshness text={t(`report.freshness.${freshness.key}`, { ...freshness.values })} />
      <ContentScreen t={t} view={view} answer={answer} flags={flags} timeZone={timeZone} />
    </>
  );
}
