import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { ProgressBar, ProgressRing, StatBlock } from '@rede-social/module-courses/ui';
import { buttonClasses, Card, cn, EmptyState, SectionTitle, Skeleton } from '@rede-social/ui';
import {
  ChevronRight,
  CircleCheck,
  CirclePlay,
  Clock,
  Flame,
  GraduationCap,
  Lock,
  type LucideIcon,
  TrendingUp,
} from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getLearnProgress } from '@/lib/courses-learn';
import { type ProgressStatKey, progressTabView } from '@/lib/courses-member-view';
import { CoverGradient } from './HomeShelf';
import { memberTabHref } from './tabs';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** "Tentar novamente": the `outline sm` look as a LINK to the tab's own URL (44px hit area). */
const RETRY_LINK = buttonClasses({
  variant: 'outline',
  size: 'sm',
  hitArea: true,
  className: 'self-start',
});

/** "Começar agora": the brand look as a LINK to Início (whose hero says where to start). */
const START_LINK = buttonClasses({ variant: 'brand', size: 'md' });

/** The panel's glyphs, neutral (UI-D-458), in the order of UI-D-457. */
const STAT_ICON: Record<ProgressStatKey, LucideIcon> = {
  lessons: CirclePlay,
  hours: Clock,
  courses: GraduationCap,
  streak: Flame,
};

/** The 2×2 grid's inner rules: the left column `border-r`, the top row `border-b`. */
const STAT_BORDER = ['border-r border-b', 'border-b', 'border-r', ''];

const ROW_SKELETONS = [62, 48];

/**
 * The Progresso skeleton (UI-D-457, UI E11 loading): the ring card (an 88px circle and two bars), a
 * 2×2 panel of bars and two row skeletons. No words.
 */
export function ProgressSkeleton() {
  return (
    <div
      aria-busy
      data-testid="courses-member-progress-skeleton"
      className="flex flex-col gap-6 pb-6"
    >
      <Card className="mx-4 flex items-center gap-4 p-4">
        <Skeleton variant="circle" className="h-[88px] w-[88px] shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-11/12" />
        </div>
      </Card>
      <Card className="mx-4 grid grid-cols-2 p-0">
        {STAT_BORDER.map((border, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, static placeholder grid.
          <div key={index} className={cn('flex flex-col gap-2 border-divider p-4', border)}>
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-6 w-1/2" />
          </div>
        ))}
      </Card>
      <Card className="mx-4 flex flex-col divide-y divide-divider p-0">
        {ROW_SKELETONS.map((width) => (
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
 * The member's Meu progresso (08.6-10, D-440..D-443, UI-D-457, UI-D-458, COURSE-36..38), ported
 * from the prototype's `app/membros/progresso/page.tsx` minus what this phase does not ship. One
 * `GET /v1/courses/learn/progress` read inside the frame's own `Suspense`, top to bottom
 * `flex flex-col gap-6 pb-6`:
 *
 *  1. the ring card — `ProgressRing` at 88px labelled with the SERVER's `percent`, then
 *     "{done} de {total} aulas concluídas" and the remaining line (or the whole-school line);
 *  2. the empty card "Seu progresso começa na primeira aula" with brand "Começar agora" to Início,
 *     only when no lesson is done;
 *  3. the numbers panel — a `<dl>` of four `StatBlock`s ("Aulas concluídas", "Horas assistidas",
 *     "Cursos concluídos", "Sequência atual"), only when any value is above zero;
 *  4. "Curso a curso" — the started courses in the server's order, each a link to its page with
 *     the bar, the line and a check at 100% or a padlock when the access was revoked.
 *
 * Only these four blocks of UI-D-457 render: the deferred and prototype-only blocks are not ported
 * and no placeholder stands in for them. An empty school (`lessonsTotal = 0`) shows the catalogue
 * empty state instead of the whole tab. The web only formats (`formatWatched`, plurals) and never
 * counts days, lessons or seconds (E02, E11, T-08.6-17). Refusals split like Início's.
 */
export async function MemberProgressTab({
  tenantName,
  preview,
}: {
  tenantName: string;
  preview: boolean;
}) {
  const [t, result] = await Promise.all([getTranslations(), getLearnProgress()]);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled') notFound();

  if (result.status === 'error') {
    return (
      <div data-testid="courses-member-progress" className="flex flex-col gap-6 pb-6">
        <Card data-testid="courses-member-progress-error" className="mx-4 flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-1">
            <p className="text-base font-bold leading-tight text-text">
              {t('courses.errors.title')}
            </p>
            <p className="text-sm font-normal text-text-secondary">
              {t('courses.errors.progress')}
            </p>
          </div>
          <a href={memberTabHref('progresso', preview)} className={RETRY_LINK}>
            {t('courses.errors.retry')}
          </a>
        </Card>
      </div>
    );
  }

  const view = progressTabView(result.page, t, preview);

  if (view.emptySchool) {
    return (
      <div data-testid="courses-member-progress" className="flex flex-col gap-6 pb-6">
        <EmptyState
          variant="card"
          icon={GraduationCap}
          data-testid="courses-member-progress-empty-school"
          className="mx-4"
          title={t('courses.member.catalogue.empty.title')}
          body={t('courses.member.catalogue.empty.body', { tenant: tenantName })}
        />
      </div>
    );
  }

  return (
    <div data-testid="courses-member-progress" className="flex flex-col gap-6 pb-6">
      <Card data-testid="courses-progress-ring-card" className="mx-4 flex items-center gap-4 p-4">
        <ProgressRing percent={view.ring.percent} size={88} label={view.ring.label} tone="page" />
        <div className="flex min-w-0 flex-1 flex-col">
          <p
            data-testid="courses-progress-ring-done"
            className="break-words text-sm font-bold text-text tabular-nums"
          >
            {view.ring.done}
          </p>
          <p
            data-testid="courses-progress-ring-sub"
            className="mt-1 break-words text-xs font-normal text-text-secondary tabular-nums"
          >
            {view.ring.sub}
          </p>
        </div>
      </Card>

      {view.empty ? (
        <EmptyState
          variant="card"
          icon={TrendingUp}
          data-testid="courses-progress-empty"
          className="mx-4"
          title={view.empty.title}
          body={view.empty.body}
          action={
            <a href={view.empty.cta.href} className={START_LINK}>
              {view.empty.cta.label}
            </a>
          }
        />
      ) : null}

      {view.stats ? (
        <Card data-testid="courses-progress-stats" className="mx-4 overflow-hidden p-0">
          <dl className="m-0 grid grid-cols-2">
            {view.stats.map((stat, index) => (
              <StatBlock
                key={stat.key}
                icon={STAT_ICON[stat.key]}
                label={stat.label}
                value={stat.value}
                className={cn('border-divider', STAT_BORDER[index])}
              />
            ))}
          </dl>
        </Card>
      ) : null}

      {view.rows.length > 0 ? (
        <section data-testid="courses-progress-courses" className="flex flex-col">
          <SectionTitle as="h3" id="courses-progress-courses-title" className="mb-3 px-4">
            {t('courses.member.myProgress.courses.title')}
          </SectionTitle>
          <Card className="mx-4 p-0">
            <ul
              aria-labelledby="courses-progress-courses-title"
              className="flex flex-col divide-y divide-divider"
            >
              {view.rows.map((row) => (
                <li key={row.id}>
                  <a
                    href={row.href}
                    aria-label={row.ariaLabel}
                    data-testid="courses-progress-row"
                    data-trailing={row.trailing}
                    className={`flex min-h-14 items-center gap-3 p-3 transition-colors hover:bg-bg-hover ${FOCUS} focus-visible:ring-inset focus-visible:ring-offset-0`}
                  >
                    <span
                      aria-hidden
                      className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary"
                    >
                      {row.coverAssetId ? (
                        <MediaImage
                          assetId={row.coverAssetId}
                          widths={PURPOSE_WIDTHS.cover}
                          alt=""
                          sizes="48px"
                          ratio=""
                          className="absolute inset-0 h-full w-full"
                          fallback={<CoverGradient />}
                        />
                      ) : (
                        <CoverGradient />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="line-clamp-1 break-words text-sm font-bold text-text">
                        {row.title}
                      </span>
                      <ProgressBar
                        percent={row.bar.percent}
                        label={row.bar.label}
                        size="sm"
                        className="mt-2"
                      />
                      <span className="mt-1 text-xs font-normal text-text-tertiary tabular-nums">
                        {row.line}
                      </span>
                    </span>
                    {row.trailing === 'done' ? (
                      <CircleCheck aria-hidden size={20} className="shrink-0 text-success" />
                    ) : null}
                    {row.trailing === 'locked' ? (
                      <Lock aria-hidden size={18} className="shrink-0 text-text-tertiary" />
                    ) : null}
                    {row.trailing === 'chevron' ? (
                      <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
                    ) : null}
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
