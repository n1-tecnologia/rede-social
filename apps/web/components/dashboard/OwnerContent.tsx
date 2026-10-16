import { ownerBandRoster, ownerContentItems } from '@rede-social/module-dashboard/fixtures';
import { Chip } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import {
  type ContentTab,
  contentBackHref,
  contentTabView,
  type OwnerContentView,
  ownerContentHref,
} from '@/lib/owner-content-view';
import type { DashboardT } from './format';
import { ContentNumberList, OwnerContentOverview } from './OwnerContentOverview';
import { OwnerContentPeople } from './OwnerContentPeople';
import { ContentPostList } from './OwnerContentPostCard';
import { OwnerContentPostDetail } from './OwnerContentPostDetail';
import { OwnerContentReplies } from './OwnerContentReplies';
import { byInteractions, OwnerContentTypes } from './OwnerContentTypes';
import { OwnerMemberDetail } from './OwnerMemberDetail';
import { OwnerMemberList } from './OwnerMemberList';
import { SPAN_ALL } from './ownerGrid';
import { PanelSection } from './PanelSection';

const KEY = 'tenantOwner.content';

const TABS = [
  { tab: 'overview', labelKey: `${KEY}.tabs.overview` },
  { tab: 'types', labelKey: `${KEY}.tabs.types` },
  { tab: 'posts', labelKey: `${KEY}.tabs.posts` },
] as const satisfies readonly { tab: ContentTab; labelKey: string }[];

/** The one row of choices of the area (D-01): three equal tabs across it, as Membros' scope tabs. */
function ContentTabs({ t, view }: { t: DashboardT; view: OwnerContentView }) {
  return (
    <nav aria-label={t(`${KEY}.tabs.label`)} className={SPAN_ALL}>
      <ul className="grid grid-cols-3 gap-2">
        {TABS.map((row) => (
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

/** Publicações (D-04): the 61 feed posts best to worst across the area, each opening its detail. */
function PostsTab({ t, view }: { t: DashboardT; view: OwnerContentView }) {
  const posts = ownerContentItems.filter((item) => item.kind !== 'story').sort(byInteractions);
  return (
    <PanelSection title={t(`${KEY}.posts.title`)} className={SPAN_ALL}>
      <p className="text-sm text-text-secondary">
        {t(`${KEY}.posts.order`, { count: posts.length })}
      </p>
      <ContentPostList
        t={t}
        items={posts}
        hrefOf={(item) => ownerContentHref({ ...view, postId: item.id })}
      />
    </PanelSection>
  );
}

/**
 * The member opened from a Conteúdo list (P1) — a publication's people, the interactors or a band of
 * "Quem interage": their insights, or the list behind one of their numbers, with the same components
 * as Membros. Their band is today's whole-base band.
 */
function ContentMember({
  t,
  view,
  memberId,
}: {
  t: DashboardT;
  view: OwnerContentView;
  memberId: string;
}) {
  const back = contentBackHref(view);
  if (back === null) throw new Error('a member with no way back');
  if (view.list) {
    return <OwnerMemberList t={t} memberId={memberId} list={view.list} backHref={back} />;
  }
  const person = ownerBandRoster.find((row) => row.id === memberId);
  if (!person) throw new Error(`no roster member ${memberId}`);
  return (
    <OwnerMemberDetail
      t={t}
      memberId={memberId}
      band={person.band}
      scope={{ kind: 'member' }}
      backHref={back}
      listHref={(slug) => ownerContentHref({ ...view, list: slug })}
    />
  );
}

/**
 * Level 4, "Conteúdo" (quick 261013-h51): one cascade of plain links, as Membros (D-01). The tab
 * screens — Visão geral, Por tipo (an opened type included) and Publicações — carry the one row of
 * three tabs (an opened band of "Quem interage" included); every deeper step (an overview number's
 * list, a publication, who did one of its numbers, a member's insights, the list behind one of them)
 * replaces the area under its "Voltar" (PD-3), as do the unanswered comments of a post in "Precisa
 * de atenção" (quick 261013-orf E-02). The period is the panel's
 * fixed 30 days against the 30 before: there is no period selector.
 */
export async function OwnerContent({ content: view }: { content: OwnerContentView }) {
  const t = await getTranslations('dashboard');
  if (view.reply) return <OwnerContentReplies t={t} view={view} />;
  if (view.memberId) return <ContentMember t={t} view={view} memberId={view.memberId} />;
  if (view.who) return <OwnerContentPeople t={t} view={view} />;
  if (view.postId) return <OwnerContentPostDetail t={t} view={view} />;
  if (view.number) return <ContentNumberList t={t} view={view} />;
  return (
    <>
      <ContentTabs t={t} view={view} />
      {view.tab === 'types' ? <OwnerContentTypes t={t} view={view} /> : null}
      {view.tab === 'posts' ? <PostsTab t={t} view={view} /> : null}
      {view.tab === 'overview' ? <OwnerContentOverview t={t} view={view} /> : null}
    </>
  );
}
