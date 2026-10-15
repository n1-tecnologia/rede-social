import { EmptyState, SectionTitle } from '@rede-social/ui';
import { CircleAlert, Radio } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { getLearnLives } from '@/lib/courses-learn';
import { liveAccessById, liveCardView } from '@/lib/courses-member-view';
import { getLiveAccessList } from '@/lib/store';
import { LIVES_GRID, MemberLiveCard, MemberLivesList } from './MemberLivesList';
import { memberTabHref } from './tabs';

const LINK_OUTLINE =
  'inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

const GROUP_TITLE = 'px-4 pb-3 text-base font-bold text-text';

/**
 * The member Lives tab (08.5-06, D-431, UI-D-434, COURSE-23, E04), server-composed:
 *
 *  - `GET /v1/courses/learn/lives` and, only while the store is on, `GET /v1/store/live-access` run
 *    in parallel (one access read per render; a failed or store-off read draws no "Exclusiva");
 *  - two groups in one scroll, each a `<section>` with its `SectionTitle` and a 2/3-column grid:
 *    "Próximas" (live now, scheduled, cancelled until its planned end — nearest first, the WHOLE
 *    group on page 1, never paged) then "Gravadas" (recorded with a replay — newest first, paged by
 *    `MemberLivesList`). A group with no card is ABSENT, title included; with both empty the lives
 *    `EmptyState` renders instead;
 *  - every card is a finished view: the status in words from the API's clock and the date in the
 *    TENANT's timezone, formatted here (UI-D-288: no clock read anywhere in the tab).
 *
 * Refusals: `disabled` → the kernel not-found; `redirect` → a navigation; anything else → the shipped
 * lives error card, whose retry is a link to the tab itself (a fresh server read).
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
      <div data-testid="lives-member-tab" className="px-4 pt-2 pb-6">
        <EmptyState
          variant="card"
          icon={CircleAlert}
          data-testid="lives-member-error"
          title={t('courses.errors.title')}
          body={t('courses.errors.lives')}
          action={
            <a href={memberTabHref('lives', preview)} className={LINK_OUTLINE}>
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

  if (upcoming.length === 0 && recorded.length === 0) {
    return (
      <div data-testid="lives-member-tab" className="px-4 pt-2 pb-6">
        <EmptyState
          variant="card"
          icon={Radio}
          data-testid="lives-member-empty"
          title={t('courses.member.lives.empty.title')}
          body={t('courses.member.lives.empty.body', { tenant: tenantName })}
        />
      </div>
    );
  }

  return (
    <div data-testid="lives-member-tab" className="flex flex-col gap-6 pb-6">
      {upcoming.length > 0 ? (
        <section aria-labelledby="lives-member-upcoming" data-testid="lives-member-upcoming-group">
          <SectionTitle id="lives-member-upcoming" variant="group" className={GROUP_TITLE}>
            {t('courses.member.lives.upcoming')}
          </SectionTitle>
          <ul
            aria-labelledby="lives-member-upcoming"
            data-testid="lives-member-upcoming"
            className={LIVES_GRID}
          >
            {upcoming.map((item, index) => (
              <li key={item.id} data-live-card={item.id} className="min-w-0">
                <MemberLiveCard view={item} eager={index < 4} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recorded.length > 0 ? (
        <section aria-labelledby="lives-member-recorded" data-testid="lives-member-recorded-group">
          <SectionTitle id="lives-member-recorded" variant="group" className={GROUP_TITLE}>
            {t('courses.member.lives.recorded')}
          </SectionTitle>
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
