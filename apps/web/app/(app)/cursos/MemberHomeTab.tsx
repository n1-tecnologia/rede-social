import { buttonClasses, Card, chipBase, cn, EmptyState, Skeleton } from '@rede-social/ui';
import { Flame, GraduationCap } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getLearnOverview } from '@/lib/courses-learn';
import { homeHeroView, streakBadgeView } from '@/lib/courses-member-view';
import { HomeHero } from './HomeHero';
import { memberTabHref } from './tabs';

/** "Tentar novamente": the `outline sm` look as a LINK to the page's own URL (44px hit area). */
const RETRY_LINK = buttonClasses({
  variant: 'outline',
  size: 'sm',
  hitArea: true,
  className: 'self-start',
});

const SHELF_ROWS = [60, 50, 66];

/**
 * Início's ONE skeleton (UI-D-447, UI E03 loading), drawn by the frame's single `Suspense` around
 * this body: the greeting bar and the badge, the hero (the 16:9 rect, two bars, the `h-2` bar and
 * the `h-11` button bar) and three 56px shelf rows inside a `Card`. No words.
 */
export function HomeSkeleton() {
  return (
    <div aria-busy data-testid="courses-member-home-skeleton" className="flex flex-col gap-6 pb-6">
      <div className="flex items-center justify-between gap-3 px-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton variant="rect" className="h-8 w-24 shrink-0 rounded-full" />
      </div>
      <Card className="mx-4 p-0">
        <Skeleton variant="rect" className="aspect-video w-full rounded-none" />
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton variant="rect" className="h-2 w-full rounded-full" />
          <Skeleton variant="rect" className="h-11 w-full rounded-xl" />
        </div>
      </Card>
      <Card className="mx-4 flex flex-col divide-y divide-divider p-0">
        {SHELF_ROWS.map((width) => (
          <div key={width} className="flex min-h-14 items-center gap-3 p-3">
            <Skeleton variant="rect" className="h-12 w-12 shrink-0 rounded-lg" />
            <Skeleton className="h-4" width={`${width}%`} />
          </div>
        ))}
      </Card>
    </div>
  );
}

/**
 * The member Início (08.6-08, D-435, D-437, D-440, D-443, UI-D-447..UI-D-449, COURSE-28, 29, 34, 37):
 * the area's home, rendered from ONE `GET /v1/courses/learn/overview` read inside the frame's ONE
 * `Suspense` (`MemberCatalogue`), top to bottom `flex flex-col gap-6 pb-6`:
 *
 *  1. the greeting row — "Bem-vindo de volta." (`min-w-0`) and the server's study streak as a
 *     static, non-interactive badge (`shrink-0`, `chipBase` geometry, `Flame` 12 `aria-hidden`):
 *     tinted above zero, neutral "Sem sequência" at zero. Display only (D-443, PR-1);
 *  2. the hero (`HomeHero`), or — an overview with no `hero` is an empty school — the shipped
 *     catalogue empty card in place of the course sections (COURSE-34).
 *
 * Later plans slot their sections in the UI-D-447 order after the hero (09: live, shelf, track, new
 * lessons, categories). A section whose key is absent renders nothing: no title, no card, no gap.
 *
 * The web decides nothing (UI-SPEC E02..E09, T-08.6-17): no lock, no hero state, no day count —
 * every value is the strict-parsed answer, and no client clock is read here. The read's refusals
 * split like the Cursos body's: `disabled` → the kernel not-found, `redirect` → a navigation outside
 * any try/catch, anything else → the error card (the frame and the row stay usable).
 */
export async function MemberHomeTab({
  tenantName,
  preview,
}: {
  tenantName: string;
  preview: boolean;
}) {
  const [t, result] = await Promise.all([getTranslations(), getLearnOverview()]);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled') notFound();

  if (result.status === 'error') {
    return (
      <div data-testid="courses-member-home" className="flex flex-col gap-6 pb-6">
        <Card data-testid="courses-member-home-error" className="mx-4 flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-1">
            <p className="text-base font-bold leading-tight text-text">
              {t('courses.errors.title')}
            </p>
            <p className="text-sm font-normal text-text-secondary">{t('courses.errors.home')}</p>
          </div>
          <a href={memberTabHref('inicio', preview)} className={RETRY_LINK}>
            {t('courses.errors.retry')}
          </a>
        </Card>
      </div>
    );
  }

  const overview = result.page;
  const streak = streakBadgeView(overview.streakDays, t);
  const hero = overview.hero ? homeHeroView(overview.hero, t, { preview }) : null;

  return (
    <div data-testid="courses-member-home" className="flex flex-col gap-6 pb-6">
      <div className="flex items-center justify-between gap-3 px-4">
        <h2 className="min-w-0 text-base font-bold leading-tight text-text">
          {t('courses.member.home.greeting')}
        </h2>
        <span
          role="img"
          aria-label={streak.ariaLabel}
          data-testid="courses-member-streak"
          data-active={streak.active}
          className={cn(
            chipBase,
            'tabular-nums',
            streak.active ? 'bg-brand/10 text-text' : 'bg-bg-input text-text-tertiary',
          )}
        >
          <Flame
            aria-hidden
            size={12}
            className={streak.active ? 'shrink-0 text-brand' : 'shrink-0'}
          />
          <span aria-hidden>{streak.label}</span>
        </span>
      </div>

      {hero ? (
        <HomeHero view={hero} />
      ) : (
        <EmptyState
          variant="card"
          icon={GraduationCap}
          data-testid="courses-member-home-empty"
          className="mx-4"
          title={t('courses.member.catalogue.empty.title')}
          body={t('courses.member.catalogue.empty.body', { tenant: tenantName })}
        />
      )}
    </div>
  );
}
