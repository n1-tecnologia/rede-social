import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import type { LearnLive } from '@rede-social/module-courses/contracts';
import { ExclusiveBadge } from '@rede-social/module-store/ui';
import { chipBase, cn, PageHeader } from '@rede-social/ui';
import { Radio } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { LockedCourseZone } from '@/app/(app)/cursos/[courseId]/CourseActionZone';
import { ReadMoreText } from '@/app/(app)/cursos/ReadMoreText';
import { getLiveReminder } from '@/lib/courses-learn';
import { livePageView } from '@/lib/courses-member-view';
import type { CoursesTranslator } from '@/lib/courses-view';
import { getLiveAccess } from '@/lib/store';
import { lockedLiveView } from '@/lib/store-view';
import { LiveReplayMedia, LiveReplayProvider } from './LiveReplay';
import { LiveStateZone } from './LiveStateZone';
import { WindowRefresh } from './useWindowRefresh';

/**
 * The member's live page (08.5-09, UI-D-435, UI-D-436, D-431..D-434, COURSE-24): what a member or a
 * `support_tenant` sees at `/cursos/lives/[liveId]` (the role split is `page.tsx`'s), server-rendered
 * from ONE read, `GET /v1/courses/learn/lives/{liveId}`:
 *
 *  - `PageHeader`: back "Voltar para Lives" to `/cursos?aba=lives`, the live title truncated;
 *  - the full-bleed 16:10 cover (the tenant gradient without one) with the status as an over-media
 *    pill ("Ao vivo agora" with `Radio` 12, "Agendada", "Gravada", "Cancelada") and, on a locked
 *    live, the store's `ExclusiveBadge` "Exclusiva"; the stack wraps (E10 overflow);
 *  - the identity: the title 24/700 wrapping anywhere, "{weekday}, {day} de {month}, {time} ·
 *    {duration} min" in the tenant timezone, the description with "Ler mais" (absent when empty);
 *  - the ONE state zone the API chose (`LiveStateZone`).
 *
 * **Clock** (UI-D-436): nothing here reads the browser clock. In the `before` and `open` states one
 * client timer (`WindowRefresh`) waits for the next window edge measured from the server's
 * `serverNow` and calls `router.refresh()`, so the link appears and leaves from the server's answer.
 *
 * **The link** (PR-1, T-08.5-07): only the API's `joinUrl` is rendered, and it is null outside the
 * window and for a locked live; no other field of this page can carry the stored room link.
 *
 * **Replay** (A-UI-7): in the `replay` state the cover box is a client slot that swaps for the
 * replay player on the tap; the cover itself is still rendered here, on the server.
 *
 * **Reminder** (08.6-11, D-444, UI-D-453, R-A12): only in the API's `before` state (open, before the
 * window) the page reads `GET /v1/courses/learn/lives/{liveId}/reminder` — its own route, so the
 * 08.5 `learnLiveSchema` answer stays byte-compatible — and draws the toggle under the "Começa em …"
 * card from that answer (a failed read draws it off; the idempotent write corrects it). In the
 * admin's preview (`?ver=aluno`, UI-D-459) nothing is read: the toggle is disabled with its hint and
 * there is no `PreviewBanner` on this page (sketch 011 finding 1, approved as drawn).
 */
export interface MemberLivePageProps {
  live: LearnLive;
  timeZone: string;
  /** The store module is on for the tenant (UI-D-442: off → nothing to buy, no access read). */
  storeOn: boolean;
  /** An `admin_tenant` with `?ver=aluno` (08.6-11, UI-D-459): the reminder toggle is disabled. */
  preview?: boolean;
}

const COVER_SIZES = '(min-width: 680px) 680px, 100vw';

export async function MemberLivePage({
  live,
  timeZone,
  storeOn,
  preview = false,
}: MemberLivePageProps) {
  const t = (await getTranslations()) as unknown as CoursesTranslator;
  const view = livePageView(live, timeZone, t);
  const liveHref = `/cursos/lives/${encodeURIComponent(live.id)}`;

  // The toggle lives in the API's `before` state only (not the zone's link-less `open` fallback).
  let reminder: { liveId: string; liveTitle: string; initialOn: boolean; preview: boolean } | null =
    null;
  if (live.state === 'before' && view.zone.state === 'before') {
    let initialOn = false;
    if (!preview) {
      const read = await getLiveReminder(live.id);
      if (read.status === 'redirect') redirect(read.path);
      initialOn = read.status === 'ok' && read.on;
    }
    reminder = { liveId: live.id, liveTitle: live.title, initialOn, preview };
  }

  let lockedZone: LockedCourseZone | null = null;
  if (view.zone.state === 'locked') {
    // Store off → nothing is buyable: the not-for-sale card (c); a failed read → (d).
    const access = storeOn ? await getLiveAccess(live.id) : null;
    const target = { liveId: live.id, liveTitle: live.title };
    const lockedView = storeOn
      ? access
        ? lockedLiveView(access, target, t)
        : null
      : lockedLiveView({ archivedTag: false, buyableProducts: [] }, target, t);
    lockedZone = {
      view: lockedView,
      choices: (lockedView?.choices ?? []).map((choice) => ({
        href: choice.href,
        name: choice.name,
        priceLabel: choice.priceLabel,
        ariaLabel: choice.ariaLabel,
        thumb: choice.imageAssetId ? (
          <MediaImage
            assetId={choice.imageAssetId}
            widths={PURPOSE_WIDTHS.cover}
            alt=""
            sizes="40px"
            ratio=""
            className="h-full w-full"
          />
        ) : (
          <span
            className="block h-full w-full"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          />
        ),
      })),
      buyLabel: t('courses.member.locked.buy'),
      storeUnavailable: t('courses.member.locked.storeUnavailable'),
      retryLabel: t('courses.errors.retry'),
      retryHref: liveHref,
      freeLesson: null,
    };
  }

  const cover = (
    <div data-testid="member-live-cover" className="relative aspect-[16/10] w-full bg-bg-tertiary">
      {view.coverAssetId ? (
        <MediaImage
          assetId={view.coverAssetId}
          widths={PURPOSE_WIDTHS.cover}
          alt={view.coverAlt}
          sizes={COVER_SIZES}
          eager
          ratio=""
          className="absolute inset-0 h-full w-full"
          fallback={
            <span
              aria-hidden
              className="absolute inset-0 block"
              style={{ backgroundImage: 'var(--brand-gradient)' }}
            />
          }
        />
      ) : (
        <span
          aria-hidden
          data-testid="member-live-cover-fallback"
          className="absolute inset-0 block"
          style={{ backgroundImage: 'var(--brand-gradient)' }}
        />
      )}
      {view.statusPill || view.exclusive ? (
        <div
          data-testid="member-live-pills"
          className="absolute top-3 right-3 left-3 flex flex-wrap items-start gap-1"
        >
          {view.statusPill ? (
            <span
              data-testid="member-live-status"
              className={cn(
                chipBase,
                'max-w-full truncate bg-black/60 text-white backdrop-blur-sm',
              )}
            >
              {view.statusPill.icon === 'radio' ? (
                <Radio size={12} aria-hidden className="shrink-0" />
              ) : null}
              {view.statusPill.label}
            </span>
          ) : null}
          {view.exclusive ? (
            <ExclusiveBadge label={t('courses.member.tags.exclusiveLive')} />
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const zone = view.zone;
  const body = (
    <div
      data-testid="member-live-page"
      data-live-id={live.id}
      data-state={zone.state}
      className="mx-auto flex w-full max-w-[680px] flex-col pb-6"
    >
      <PageHeader
        title={view.title}
        backHref={view.backHref}
        backLabel={t('courses.member.live.back')}
        stickyTop="0px"
        className="md:static md:px-0"
      />

      {zone.state === 'replay' && zone.video ? (
        <LiveReplayMedia cover={cover} lessonId={zone.lessonId} video={zone.video} />
      ) : (
        cover
      )}

      <div className="flex flex-col gap-2 px-4 pt-4">
        <p
          data-testid="member-live-title"
          data-brand-title
          className="text-2xl font-bold leading-tight tracking-[-0.02em] text-text [overflow-wrap:anywhere]"
        >
          {view.title}
        </p>
        <p
          data-testid="member-live-meta"
          className="text-sm font-normal text-text-secondary tabular-nums [overflow-wrap:anywhere]"
        >
          {view.meta}
        </p>
        {view.description ? (
          <ReadMoreText
            id="live-about-text"
            data-testid="member-live-description"
            text={view.description}
            moreLabel={t('courses.member.readMore')}
            lessLabel={t('courses.member.readLess')}
          />
        ) : null}
      </div>

      <LiveStateZone zone={zone} locked={lockedZone} reminder={reminder} />
      <WindowRefresh input={view.refresh} />
    </div>
  );

  return zone.state === 'replay' ? (
    <LiveReplayProvider key={live.id} liveHref={liveHref} completed={zone.completed}>
      {body}
    </LiveReplayProvider>
  ) : (
    body
  );
}
