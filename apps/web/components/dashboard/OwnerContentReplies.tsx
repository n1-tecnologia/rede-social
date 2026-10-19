import type {
  OwnerContentReady,
  OwnerContentUnansweredAnswer,
} from '@rede-social/module-dashboard/contracts';
import { CountUp } from '@rede-social/module-dashboard/ui';
import { cn } from '@rede-social/ui';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getOwnerContentUnanswered } from '@/lib/dashboard';
import {
  CONTENT_FIRST_PAGE,
  contentItemsById,
  contentReplyRowViews,
} from '@/lib/owner-content-rows';
import { contentBackHref, type OwnerContentView, ownerContentHref } from '@/lib/owner-content-view';
import { OWNER_PANEL_ANCHOR } from '@/lib/owner-panel';
import { BackLink } from './BackLink';
import type { DashboardT } from './format';
import { OwnerAreaState } from './OwnerAreaState';
import { OwnerListMore } from './OwnerListMore';
import { OwnerListRows } from './OwnerListRows';
import { SPAN_ALL } from './ownerGrid';
import { PanelSection } from './PanelSection';

const KEY = 'tenantOwner.content';

type UnansweredReady = Extract<OwnerContentUnansweredAnswer, { state: 'ready' }>;

export interface OwnerContentRepliesViewProps {
  t: DashboardT;
  view: OwnerContentView;
  /** The area answer: a waiting comment names its publication when it is still in it. */
  answer: OwnerContentReady;
  /** The first page of `GET …/content/unanswered`. */
  page: UnansweredReady;
  timeZone: string;
  nowMs: number;
}

/**
 * The comments waiting for the team (quick 261013-orf E-02, 08.7-07): "Voltar" to "Precisa de
 * atenção", how many, then each root member comment no current staff answered for over 24 hours,
 * oldest first, as a card — who wrote it, their band, the text (P4: admin only), the publication,
 * when, and "Responder", which opens `/post/[postId]` where the team answers (D-461). Story replies
 * are flat and never here (UI-D-489 b). "Ver todos" continues in place (UI-D-477). It reads across
 * the whole area: the comments in columns on the web.
 */
export function OwnerContentRepliesView({
  t,
  view,
  answer,
  page,
  timeZone,
  nowMs,
}: OwnerContentRepliesViewProps) {
  const back = contentBackHref(view);
  if (back === null) throw new Error('the waiting comments with no way back');
  const rows = contentReplyRowViews(t, page.rows, {
    items: contentItemsById(answer),
    timeZone,
    nowMs,
  });
  const more = page.total - rows.length;
  return (
    <div className={cn('flex min-w-0 flex-col gap-3', SPAN_ALL)}>
      <BackLink href={back} label={t('tenantOwner.memberDetail.back')} />
      <PanelSection title={t(`${KEY}.replies.title`)} prominent>
        {rows.length === 0 ? (
          <p className="text-sm text-text-secondary">{t(`${KEY}.overview.attention.empty`)}</p>
        ) : (
          <>
            <p className="text-sm font-semibold text-warning">
              <CountUp value={t(`${KEY}.replies.count`, { count: page.total })} />
            </p>
            <OwnerListRows rows={rows} layout="cards-wide" />
            {page.nextCursor !== null ? (
              <OwnerListMore
                request={{ kind: 'content-unanswered' }}
                cursor={page.nextCursor}
                layout="cards-wide"
                more={more > 0 ? t(`${KEY}.replies.more`, { count: more }) : null}
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

export interface OwnerContentRepliesProps {
  view: OwnerContentView;
  answer: OwnerContentReady;
  timeZone: string;
}

/**
 * The waiting comments read live from `GET …/content/unanswered` (08.7-06, admin only), streamed in
 * its own `Suspense` by the caller; a failed read is the list's error card (UI-D-479).
 */
export async function OwnerContentReplies({ view, answer, timeZone }: OwnerContentRepliesProps) {
  const [t, read] = await Promise.all([
    getTranslations('dashboard'),
    getOwnerContentUnanswered({ limit: CONTENT_FIRST_PAGE }),
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
    <OwnerContentRepliesView
      t={t}
      view={view}
      answer={answer}
      page={read.answer}
      timeZone={timeZone}
      nowMs={Date.now()}
    />
  );
}
