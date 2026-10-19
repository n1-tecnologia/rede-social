import {
  OWNER_MEMBER_LIST_PAGE_SIZE,
  type OwnerMemberDetailReady,
  type OwnerMemberListId,
  type OwnerMemberListReady,
} from '@rede-social/module-dashboard/contracts';
import { cn } from '@rede-social/ui';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { getOwnerMemberDetail, getOwnerMemberList } from '@/lib/dashboard';
import {
  OWNER_MEASURED_LISTS,
  OWNER_MEMBER_LIST_ANCHOR,
  type OwnerMeasuredListSlug,
  type OwnerMembersView,
  ownerInsightAnchor,
  ownerMembersHref,
} from '@/lib/owner-band-scope';
import { MEMBER_LIST_KEYS, memberListRowViews } from '@/lib/owner-list-view';
import { OWNER_PANEL_ANCHOR } from '@/lib/owner-panel';
import { BackLink } from './BackLink';
import type { DashboardT } from './format';
import { OwnerAreaState } from './OwnerAreaState';
import { OwnerListMore } from './OwnerListMore';
import { OwnerListRows } from './OwnerListRows';
import { SPAN_ALL } from './ownerGrid';
import { PanelSection } from './PanelSection';

const KEY = 'tenantOwner.memberLists';

/** The detail's own number behind each list: the list's count line says it (D-461). */
function totalOf(last30: OwnerMemberDetailReady['last30'], list: OwnerMemberListId): number {
  switch (list) {
    case 'active-days':
      return last30.activeDays;
    case 'likes':
      return last30.likes;
    case 'comments':
      return last30.comments;
    case 'strong-actions':
      return last30.strongActions;
  }
}

export interface OwnerMemberListViewProps {
  t: DashboardT;
  /** The first page of `GET …/members/{membershipId}/lists/{list}`. */
  list: OwnerMemberListReady;
  /** The detail's number behind this list (the count line). */
  total: number;
  /** The member's name (the line beside the title). */
  name: string;
  membershipId: string;
  timeZone: string;
  nowMs: number;
  /** "Voltar": the member detail, landing on the number that opened the list. */
  backHref: string;
}

/**
 * The list behind one of a member's numbers (quick 261012-tru D-07; 08.7-05 on real rows): "Voltar"
 * to the number that opened it, the title, the member and the window, the count with the order of
 * the rows, then the first page on the panels' surface (or one sentence when there are none), and
 * "Ver todos" continuing in place while the API has a next page (UI-D-477). A row names the post, the
 * event or the product, never a comment's text. Visible to the client's management only.
 */
export function OwnerMemberListView({
  t,
  list,
  total,
  name,
  membershipId,
  timeZone,
  nowMs,
  backHref,
}: OwnerMemberListViewProps) {
  const block = `${KEY}.${MEMBER_LIST_KEYS[list.list]}`;
  const rows = memberListRowViews(t, list, { timeZone, nowMs });
  return (
    <div
      id={OWNER_MEMBER_LIST_ANCHOR}
      className={cn('flex min-w-0 scroll-mt-20 flex-col gap-3', SPAN_ALL)}
    >
      <BackLink href={backHref} label={t('tenantOwner.memberDetail.back')} />
      <PanelSection title={t(`${block}.title`)} period={t(`${KEY}.period`, { name })} prominent>
        <p className="text-sm text-text-secondary">{t(`${block}.count`, { count: total })}</p>
        {rows.length === 0 ? (
          <p className="text-sm text-text-secondary">{t(`${block}.empty`)}</p>
        ) : (
          <>
            <OwnerListRows rows={rows} layout="rows" />
            {list.nextCursor !== null ? (
              <OwnerListMore
                request={{ kind: 'member-list', membershipId, list: list.list }}
                cursor={list.nextCursor}
                layout="rows"
                more={null}
                labels={{
                  seeAll: t('tenantOwner.bandMembers.seeAll'),
                  error: t('report.errors.more'),
                  retry: t('report.errors.retry'),
                }}
              />
            ) : null}
          </>
        )}
      </PanelSection>
    </div>
  );
}

/** Where a member list's links go: Membros builds them from its view, Conteúdo from its own. */
export interface OwnerMemberListLinks {
  /** "Voltar": the member detail, landing on the number that opened the list. */
  back: string;
  /** "Tentar novamente": the same screen, landing on the panel. */
  retry: string;
}

/** The links of a list opened from a Membros member (08.7-05). */
export function membersListLinks(
  view: OwnerMembersView & { memberId: string; list: OwnerMeasuredListSlug },
): OwnerMemberListLinks {
  return {
    back: `${ownerMembersHref({ ...view, list: null })}#${ownerInsightAnchor(view.list)}`,
    retry: `${ownerMembersHref(view).split('#')[0]}#${OWNER_PANEL_ANCHOR}`,
  };
}

export interface OwnerMemberListProps {
  /** The opened member's membership id and the measured list behind one of their numbers. */
  memberId: string;
  list: OwnerMeasuredListSlug;
  links: OwnerMemberListLinks;
  timeZone: string;
  /** What renders for a member the API does not know for this tenant: the list above (D-06). */
  fallback: ReactNode;
}

/**
 * A member's list read from the API (08.7-05), streamed in its own `Suspense` by the caller: the
 * first page, with the detail's number as its count (one cached request each). An unknown or
 * other-tenant member falls back to the list above; a failed read is the list's error card
 * (UI-D-479); a member with no row in the newest build is "preparing".
 */
export async function OwnerMemberList({
  memberId,
  list: slug,
  links,
  timeZone,
  fallback,
}: OwnerMemberListProps) {
  const list = OWNER_MEASURED_LISTS[slug];
  const [t, detail, page] = await Promise.all([
    getTranslations('dashboard'),
    getOwnerMemberDetail(memberId),
    getOwnerMemberList(memberId, list, { limit: OWNER_MEMBER_LIST_PAGE_SIZE }),
  ]);
  for (const read of [detail, page]) {
    if (read.status === 'redirect') redirect(read.path);
  }
  if (detail.status === 'notFound' || page.status === 'notFound') return fallback;
  if (detail.status !== 'ok' || page.status !== 'ok') {
    return <OwnerAreaState kind="error" body="list" retryHref={links.retry} />;
  }
  if (detail.answer.state === 'preparing' || page.answer.state === 'preparing') {
    return <OwnerAreaState kind="preparing" scope="area" />;
  }
  return (
    <OwnerMemberListView
      t={t}
      list={page.answer}
      total={totalOf(detail.answer.last30, list)}
      name={detail.answer.member.displayName}
      membershipId={memberId}
      timeZone={timeZone}
      nowMs={Date.now()}
      backHref={links.back}
    />
  );
}
