import { buttonClasses, cn, Skeleton } from '@rede-social/ui';
import { CircleAlert, Radio } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { CSSProperties } from 'react';
import { requireBootstrap } from '@/lib/bootstrap';
import { getLearnLives } from '@/lib/courses-learn';
import { liveAccessById, liveCardView } from '@/lib/courses-member-view';
import { memberScreenHref } from '@/lib/member-area';
import { getLiveAccessList } from '@/lib/store';
import { MEMBER_EMPTY_WIDE, MemberEmptyCard } from './MemberEmptyCard';
import { MemberLiveCard, MemberLivesList } from './MemberLivesList';
import { MemberSectionHeader } from './MemberSection';

/** "Tentar novamente": the `outline sm` look as a LINK to the screen's own URL (44px hit area). */
const RETRY_LINK = buttonClasses({ variant: 'outline', size: 'sm', hitArea: true });

/**
 * 2026-10-23 (the wide desktop): from `lg` "Próximas" puts the spotlight (3 parts, left) beside the
 * agenda (2 parts, right); the spotlight spans as many grid rows as there are agenda rows
 * (`--agenda-rows`), so the agenda stacks beside it.
 */
const UPCOMING_SPLIT =
  'lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-x-4 lg:gap-y-3';
const SPOTLIGHT_CELL = 'lg:[grid-column:1] lg:[grid-row:1/span_var(--agenda-rows)]';
const AGENDA_CELL = 'lg:[grid-column:2]';

const AGENDA_SKELETONS = [0, 1];

/**
 * The Lives screen's first-load skeleton (2026-10-23), at "Próximas"'s geometry: the title bar, the
 * spotlight's cover and two agenda rows, side by side from `lg` as the screen draws them. Shared by
 * the frame's `Suspense` and `area-membros/lives/loading.tsx`. No words.
 */
export function LivesSkeleton() {
  return (
    <div aria-busy data-testid="lives-member-skeleton" className="flex flex-col pt-2 pb-6">
      <Skeleton className="mx-4 mb-2.5 h-4 w-28" />
      <div
        className={cn('flex flex-col gap-3 px-4', UPCOMING_SPLIT)}
        style={{ '--agenda-rows': AGENDA_SKELETONS.length } as CSSProperties}
      >
        <Skeleton
          variant="rect"
          className={cn('aspect-[16/10] w-full rounded-2xl md:aspect-[2/1]', SPOTLIGHT_CELL)}
        />
        {AGENDA_SKELETONS.map((index) => (
          <Skeleton
            key={index}
            variant="rect"
            className={cn('h-[88px] w-full rounded-xl', AGENDA_CELL)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The member Lives (08.5-06, D-431, UI-D-434, COURSE-23, E04), server-composed:
 *
 *  - `GET /v1/courses/learn/lives` and, only while the store is on, `GET /v1/store/live-access` run
 *    in parallel (one access read per render; a failed or store-off read draws no "Exclusiva");
 *  - two groups in one scroll, each a `<section>` named by its title: "Próximas" (live now,
 *    scheduled, cancelled until its planned end — nearest first, the WHOLE group on page 1, never
 *    paged) then "Gravadas" (recorded with a replay — newest first, paged by `MemberLivesList`). A
 *    group with no card is ABSENT, title included; with both empty the lives empty card renders;
 *  - every card is a finished view: the status in words from the API's clock and the date in the
 *    TENANT's timezone, formatted on the server (UI-D-288: no clock read anywhere here).
 *
 * Refusals: `disabled` → the kernel not-found; `redirect` → a navigation; anything else → the lives
 * error card, whose retry is a link to the screen itself (a fresh server read).
 *
 * **2026-10-22 (the courses area redesign on the social-igoralves prototype's Lives).** The body of
 * its own screen (`/area-membros/lives`, under the frame's `ScreenHeader`). "Próximas" draws its
 * FIRST card as the prototype's spotlight (the large cover, the red chip while on air) and every
 * other one as an agenda row (the date column, the status in words, "{time} · {duration} min"), in
 * the server's order; "Gravadas" is the grid of tiles (the words on the cover). Both under the
 * 17/800 title rows; empty and error are the area's `MemberEmptyCard`.
 *
 * **2026-10-23 (the wide desktop).** From `lg` the spotlight and the agenda share a row, and
 * "Gravadas" grows to four tiles a row.
 *
 * **2026-10-26 (the academy reference's card language).** A lone spotlight spans the row as a 3:1
 * banner (`wide`), and "Gravadas" is the grid of the catalogue's cards (`LiveCard` `card`: the cover
 * on top, the title and the date under it), one a row on a phone, two from 480px, three from `lg`
 * and four from `xl`.
 */
export async function MemberLivesTab({
  tenantName,
  timeZone,
  preview,
}: {
  tenantName: string;
  /** `bootstrap.tenant.timezone`: the zone every date line is formatted in. */
  timeZone: string;
  preview: boolean;
}) {
  const [t, bootstrap] = await Promise.all([getTranslations(), requireBootstrap()]);
  const storeOn = bootstrap.modules.some((module) => module.key === 'store');
  const [result, access] = await Promise.all([
    getLearnLives(),
    storeOn ? getLiveAccessList() : Promise.resolve(null),
  ]);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled') notFound();

  if (result.status === 'error') {
    return (
      <div data-testid="lives-member-tab" className="px-4 pb-6">
        <MemberEmptyCard
          className={MEMBER_EMPTY_WIDE}
          icon={CircleAlert}
          tone="error"
          data-testid="lives-member-error"
          title={t('courses.errors.title')}
          body={t('courses.errors.lives')}
          action={
            <a href={memberScreenHref('lives', {}, preview)} className={RETRY_LINK}>
              {t('courses.errors.retry')}
            </a>
          }
        />
      </div>
    );
  }

  const byId = liveAccessById(access);
  const view = (card: (typeof result.page.upcoming)[number]) =>
    liveCardView(card, byId?.get(card.id), timeZone, t, { preview });
  const upcoming = result.page.upcoming.map(view);
  const recorded = result.page.recorded.map(view);
  const split = upcoming.length > 1;

  if (upcoming.length === 0 && recorded.length === 0) {
    return (
      <div data-testid="lives-member-tab" className="px-4 pb-6">
        <MemberEmptyCard
          className={MEMBER_EMPTY_WIDE}
          icon={Radio}
          data-testid="lives-member-empty"
          title={t('courses.member.lives.empty.title')}
          body={t('courses.member.lives.empty.body', { tenant: tenantName })}
        />
      </div>
    );
  }

  return (
    <div data-testid="lives-member-tab" className="flex flex-col gap-7 pt-2 pb-6">
      {upcoming.length > 0 ? (
        <section aria-labelledby="lives-member-upcoming" data-testid="lives-member-upcoming-group">
          <MemberSectionHeader
            id="lives-member-upcoming"
            title={t('courses.member.lives.upcoming')}
          />
          <ul
            aria-labelledby="lives-member-upcoming"
            data-testid="lives-member-upcoming"
            className={cn('flex flex-col gap-3 px-4', split && UPCOMING_SPLIT)}
            style={split ? ({ '--agenda-rows': upcoming.length - 1 } as CSSProperties) : undefined}
          >
            {upcoming.map((item, index) => (
              <li
                key={item.id}
                data-live-card={item.id}
                className={cn(
                  'min-w-0',
                  index === 0 ? (split ? SPOTLIGHT_CELL : undefined) : AGENDA_CELL,
                )}
              >
                <MemberLiveCard
                  view={item}
                  eager={index === 0}
                  variant={index === 0 ? 'spotlight' : 'agenda'}
                  wide={index === 0 && !split}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recorded.length > 0 ? (
        <section aria-labelledby="lives-member-recorded" data-testid="lives-member-recorded-group">
          <MemberSectionHeader
            id="lives-member-recorded"
            title={t('courses.member.lives.recorded')}
          />
          <MemberLivesList
            labelledBy="lives-member-recorded"
            preview={preview}
            initialItems={recorded}
            initialCursor={result.page.nextCursor}
          />
        </section>
      ) : null}
    </div>
  );
}
