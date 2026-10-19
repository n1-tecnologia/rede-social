import type {
  ContentItemAnswer,
  OwnerContentInteractionsAnswer,
  OwnerContentPeopleReady,
  OwnerContentReady,
} from '@rede-social/module-dashboard/contracts';
import { CountUp } from '@rede-social/module-dashboard/ui';
import { cn } from '@rede-social/ui';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { getOwnerContentInteractions, getOwnerContentPeople } from '@/lib/dashboard';
import {
  CONTENT_FIRST_PAGE,
  contentInteractionRowViews,
  contentItemsById,
  contentPeopleRowViews,
  contentPlaceOf,
} from '@/lib/owner-content-rows';
import {
  type ContentWho,
  contentBackHref,
  type OwnerContentView,
  ownerContentHref,
} from '@/lib/owner-content-view';
import { OWNER_PANEL_ANCHOR } from '@/lib/owner-panel';
import { BackLink } from './BackLink';
import type { DashboardT } from './format';
import { OwnerAreaState } from './OwnerAreaState';
import { OwnerListMore } from './OwnerListMore';
import { OwnerListRows } from './OwnerListRows';
import { SPAN_ALL } from './ownerGrid';
import { PanelSection } from './PanelSection';

/*
 * The names behind the Conteúdo numbers (08.7-07, D-461, P1): who liked and who commented a
 * publication, and every interaction behind the interactions number, read from the API, members
 * only (UI-D-484), never a comment's text (P4: that is the waiting comments' screen only), and no
 * views, reach, saves or shares list ever leads here (P3, D-455).
 */

const KEY = 'tenantOwner.content.people';

type OwnerContentInteractionsReady = Extract<OwnerContentInteractionsAnswer, { state: 'ready' }>;

/** The retry and error labels of a list's island (UI-D-477). */
function moreLabels(t: DashboardT, seeAll: string) {
  return { seeAll, error: t('report.errors.more'), retry: t('report.errors.retry') };
}

export interface OwnerContentPeopleViewProps {
  t: DashboardT;
  view: OwnerContentView & { postId: string; who: ContentWho };
  /** The publication, as the area answer carries it (its caption). */
  item: Pick<ContentItemAnswer, 'excerpt'>;
  /** The first page of `GET …/content/items/{itemId}/people/{who}`. */
  page: OwnerContentPeopleReady;
  timeZone: string;
  nowMs: number;
}

/**
 * Who did one of a publication's numbers (D-06, P1): "Voltar" to that number, the title, which
 * publication, the count, then the member cards most recent first, each saying when the person did
 * it — commenters the team has not answered first, marked "Sem resposta" (never the comment's
 * text). Each card opens the panel's member detail (D-461); "Ver todos" continues the list in place
 * (UI-D-477). It reads across the whole area.
 */
export function OwnerContentPeopleView({
  t,
  view,
  item,
  page,
  timeZone,
  nowMs,
}: OwnerContentPeopleViewProps) {
  const back = contentBackHref(view);
  if (back === null) throw new Error('a people list with no way back');
  const who = view.who;
  const place = contentPlaceOf(view);
  const rows = contentPeopleRowViews(t, page, { place, itemId: view.postId, timeZone, nowMs });
  const more = page.total - rows.length;
  return (
    <div className={cn('flex min-w-0 flex-col gap-3', SPAN_ALL)}>
      <BackLink href={back} label={t('tenantOwner.memberDetail.back')} />
      <PanelSection title={t(`${KEY}.title.${who}`)} prominent>
        <p className="text-sm text-text [overflow-wrap:anywhere]">{item.excerpt}</p>
        <p className="text-sm text-text-secondary">
          <CountUp value={t(`${KEY}.count.${who}`, { count: page.total })} />
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-text-secondary">{t(`${KEY}.empty.${who}`)}</p>
        ) : (
          <>
            <OwnerListRows rows={rows} layout="cards-wide" />
            {page.nextCursor !== null ? (
              <OwnerListMore
                request={{ kind: 'content-people', itemId: view.postId, who, place }}
                cursor={page.nextCursor}
                layout="cards-wide"
                more={more > 0 ? t(`${KEY}.more.${who}`, { count: more }) : null}
                labels={moreLabels(t, t('tenantOwner.bandMembers.seeAll'))}
              />
            ) : null}
          </>
        )}
      </PanelSection>
    </div>
  );
}

export interface OwnerContentPeopleProps {
  view: OwnerContentView & { postId: string; who: ContentWho };
  answer: OwnerContentReady;
  timeZone: string;
  /** The publication's detail (an id the API does not know falls back to it, D-06). */
  fallback: ReactNode;
}

/**
 * Who liked or who commented, read from `GET …/content/items/{itemId}/people/{who}` (08.7-06),
 * streamed in its own `Suspense` by the caller: the first CONTENT_FIRST_PAGE rows; an id the API
 * does not know (or one outside the newest build's window) falls back to the level above; a failed
 * read is the list's error card (UI-D-479).
 */
export async function OwnerContentPeople({
  view,
  answer,
  timeZone,
  fallback,
}: OwnerContentPeopleProps) {
  const [t, read] = await Promise.all([
    getTranslations('dashboard'),
    getOwnerContentPeople(view.postId, view.who, { limit: CONTENT_FIRST_PAGE }),
  ]);
  if (read.status === 'redirect') redirect(read.path);
  if (read.status === 'notFound') return fallback;
  if (read.status === 'error') {
    return (
      <OwnerAreaState
        kind="error"
        body="list"
        retryHref={`${ownerContentHref(view)}#${OWNER_PANEL_ANCHOR}`}
      />
    );
  }
  if (read.answer.state === 'preparing') return <OwnerAreaState kind="preparing" scope="area" />;
  const item = answer.items.find((row) => row.id === view.postId);
  return (
    <OwnerContentPeopleView
      t={t}
      view={view}
      item={{ excerpt: item?.excerpt ?? '' }}
      page={read.answer}
      timeZone={timeZone}
      nowMs={Date.now()}
    />
  );
}

export interface ContentInteractionsViewProps {
  t: DashboardT;
  answer: OwnerContentReady;
  /** The first page of `GET …/content/interactions`. */
  page: OwnerContentInteractionsReady;
  timeZone: string;
  nowMs: number;
}

/**
 * The interactions themselves (PD-7): the publication's decorative cover, who, their band, liked or
 * commented and when, and which publication, most recent first; each row opens the member (D-461),
 * the first row of a member carrying the anchor their "Voltar" lands on. One list card on the
 * report's surface, two columns of rows on the web; "Ver todas" continues it in place (UI-D-477).
 */
export function ContentInteractionsView({
  t,
  answer,
  page,
  timeZone,
  nowMs,
}: ContentInteractionsViewProps) {
  const key = 'tenantOwner.content.interactions';
  const rows = contentInteractionRowViews(t, page.rows, {
    items: contentItemsById(answer),
    timeZone,
    nowMs,
  });
  if (rows.length === 0) {
    return <p className="text-sm text-text-secondary">{t('tenantOwner.content.list.empty')}</p>;
  }
  const more = page.total - rows.length;
  return (
    <>
      <OwnerListRows rows={rows} layout="interactions" />
      {page.nextCursor !== null ? (
        <OwnerListMore
          request={{ kind: 'content-interactions' }}
          cursor={page.nextCursor}
          layout="interactions"
          more={more > 0 ? t(`${key}.more`, { count: more }) : null}
          labels={moreLabels(t, t(`${key}.seeAll`))}
        />
      ) : null}
    </>
  );
}

/**
 * Every interaction behind the number, read from `GET …/content/interactions` (08.7-06), streamed
 * in its own `Suspense` by the caller; a failed read is the list's error card (UI-D-479).
 */
export async function ContentInteractions({
  view,
  answer,
  timeZone,
}: {
  view: OwnerContentView;
  answer: OwnerContentReady;
  timeZone: string;
}) {
  const [t, read] = await Promise.all([
    getTranslations('dashboard'),
    getOwnerContentInteractions({ limit: CONTENT_FIRST_PAGE }),
  ]);
  if (read.status === 'redirect') redirect(read.path);
  if (read.status === 'error') {
    return (
      <OwnerAreaState
        kind="error"
        body="list"
        retryHref={`${ownerContentHref(view)}#${OWNER_PANEL_ANCHOR}`}
      />
    );
  }
  if (read.answer.state === 'preparing') return <OwnerAreaState kind="preparing" scope="area" />;
  return (
    <ContentInteractionsView
      t={t}
      answer={answer}
      page={read.answer}
      timeZone={timeZone}
      nowMs={Date.now()}
    />
  );
}
