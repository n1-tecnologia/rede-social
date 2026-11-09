import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { MEMBER_CARD, ProgressBar, ProgressRing, StatBlock } from '@rede-social/module-courses/ui';
import { buttonClasses, Card, cn, Skeleton } from '@rede-social/ui';
import {
  Check,
  ChevronRight,
  CircleAlert,
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
import { memberScreenHref } from '@/lib/member-area';
import { MEMBER_EMPTY_WIDE, MemberEmptyCard } from './MemberEmptyCard';
import { CoverGradient, MemberSectionHeader } from './MemberSection';
import { riseStyle } from './rise';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** "Tentar novamente": the `outline sm` look as a LINK to the screen's own URL (44px hit area). */
const RETRY_LINK = buttonClasses({ variant: 'outline', size: 'sm', hitArea: true });

/** "Começar agora": the brand look as a LINK to Início (whose hero says where to start). */
const START_LINK = buttonClasses({ variant: 'brand', size: 'md' });

/** The panel's glyphs (in the brand ink since 2026-10-22), in the order of UI-D-457. */
const STAT_ICON: Record<ProgressStatKey, LucideIcon> = {
  lessons: CirclePlay,
  hours: Clock,
  courses: GraduationCap,
  streak: Flame,
};

/** The 2×2 grid's inner rules: the left column `border-r`, the top row `border-b`. */
/**
 * The cells' inner rules: a 2×2 grid on a phone and, since 2026-10-26 (the academy reference's
 * numbers strip), one row of four from `lg`, ruled between the cells only.
 */
const STAT_BORDER = [
  'border-r border-b lg:border-b-0',
  'border-b lg:border-r lg:border-b-0',
  'border-r',
  '',
];

/** The numbers: two columns, four from `lg`. */
const STAT_GRID = 'm-0 grid grid-cols-2 lg:grid-cols-4';

const ROW_SKELETONS = [62, 48];

/**
 * 2026-10-23 (the wide desktop): from `lg` the ring card and the numbers panel, or the "start" card,
 * share the first row. 2026-10-26: one part to two, so the numbers fit in one row of four.
 */
const TOP_SPLIT =
  'flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-stretch lg:gap-x-0';

/**
 * "Curso a curso" from `lg`: the one outlined card of ruled rows becomes two columns of outlined
 * rows (the card steps back, each row keeps its own outline).
 */
/**
 * "Curso a curso" (2026-10-26, the member skin): each course its own glass card (`ms-card
 * ms-panel`), one column on a phone and two from `lg`, the course cover at 16:9 (the academy
 * reference's resume card) instead of the 48px square.
 */
const ROWS_LIST = 'flex flex-col gap-2.5 px-4 lg:grid lg:grid-cols-2 lg:gap-3';
const ROW_CARD =
  'ms-card ms-panel group flex min-h-16 items-center gap-3 overflow-hidden rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-bg-hover';

/**
 * The Progresso skeleton (UI-D-457, UI E11 loading), at the 2026-10-22 geometry: the ring card (an
 * 88px circle and two bars), the 2×2 panel of bars and two row skeletons, all outlined. No words.
 * 2026-10-23: at the wide desktop's geometry too (the first row split, the rows in two columns).
 */
export function ProgressSkeleton() {
  return (
    <div
      aria-busy
      data-testid="courses-member-progress-skeleton"
      className="flex flex-col gap-6 pb-6"
    >
      <div className={TOP_SPLIT}>
        <Card className={cn(MEMBER_CARD, 'ms-panel mx-4 flex items-center gap-5 rounded-3xl p-5')}>
          <Skeleton variant="circle" className="h-[88px] w-[88px] shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-11/12" />
          </div>
        </Card>
        <Card className={cn(MEMBER_CARD, 'ms-panel mx-4 overflow-hidden rounded-3xl p-0')}>
          <div className={STAT_GRID}>
            {STAT_BORDER.map((border) => (
              <div
                key={`cell-${border}`}
                className={cn(
                  'flex min-h-[116px] flex-col justify-between gap-4 border-border p-4 lg:min-h-[148px] lg:p-6',
                  border,
                )}
              >
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-6 w-1/2" />
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className={ROWS_LIST}>
        {ROW_SKELETONS.map((width) => (
          <div
            key={width}
            className="ms-panel flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-card p-4"
          >
            <Skeleton variant="rect" className="aspect-video w-24 shrink-0 rounded-xl sm:w-32" />
            <Skeleton className="h-4" width={`${width}%`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The member's Meu progresso (08.6-10, D-440..D-443, UI-D-457, UI-D-458, COURSE-36..38), ported
 * from the prototype's `app/membros/progresso/page.tsx` minus what this phase does not ship. One
 * `GET /v1/courses/learn/progress` read inside the frame's own `Suspense`, top to bottom:
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
 * Only these four blocks of UI-D-457 render: the deferred and prototype-only blocks (certificates,
 * the demo) are not ported and no placeholder stands in for them. An empty school (`lessonsTotal =
 * 0`) shows the catalogue empty state instead of the whole tab. The web only formats
 * (`formatWatched`, plurals) and never counts days, lessons or seconds (E02, E11, T-08.6-17).
 * Refusals split like Início's.
 *
 * **2026-10-22 (the courses area redesign on the social-igoralves prototype's Meu progresso).** The
 * body of its own screen (`/area-membros/progresso`, under the frame's `ScreenHeader`), in the
 * prototype's outlined cards: the ring (which draws itself in) beside its two lines, the numbers as
 * ONE 2×2 card with inner rules (brand glyphs, 26/800 values), and "Curso a curso" under the 17/800
 * title row as one card of rows with rules between them (the 48px thumb, the title, the thin bar
 * filling in, the line, the state: the success disc, the padlock or the chevron).
 *
 * **2026-10-23 (the wide desktop).** From `lg` the ring card and the numbers (or the "start" card)
 * share the first row, and "Curso a curso" lays its rows out in two columns, each row outlined.
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
        <MemberEmptyCard
          icon={CircleAlert}
          tone="error"
          data-testid="courses-member-progress-error"
          className={cn('mx-4', MEMBER_EMPTY_WIDE)}
          title={t('courses.errors.title')}
          body={t('courses.errors.progress')}
          action={
            <a href={memberScreenHref('progresso', {}, preview)} className={RETRY_LINK}>
              {t('courses.errors.retry')}
            </a>
          }
        />
      </div>
    );
  }

  const view = progressTabView(result.page, t, preview);

  if (view.emptySchool) {
    return (
      <div data-testid="courses-member-progress" className="flex flex-col gap-6 pb-6">
        <MemberEmptyCard
          icon={GraduationCap}
          data-testid="courses-member-progress-empty-school"
          className={cn('mx-4', MEMBER_EMPTY_WIDE)}
          title={t('courses.member.catalogue.empty.title')}
          body={t('courses.member.catalogue.empty.body', { tenant: tenantName })}
        />
      </div>
    );
  }

  // The first row splits only with ONE card beside the ring (the numbers, or the start card); in
  // the split the start card fills its column, alone it keeps the wide screen's readable width.
  const split = Boolean(view.empty) !== Boolean(view.stats);

  return (
    <div data-testid="courses-member-progress" className="flex flex-col gap-6 pb-6">
      <div className={split ? TOP_SPLIT : 'flex flex-col gap-6'}>
        <Card
          data-testid="courses-progress-ring-card"
          className={cn(MEMBER_CARD, 'ms-panel mx-4 flex items-center gap-5 rounded-3xl p-5')}
        >
          {/* 2026-10-26: a soft brand halo behind the ring (decorative). */}
          <span className="relative shrink-0">
            <span aria-hidden className="absolute inset-1 rounded-full bg-brand/20 blur-xl" />
            <ProgressRing
              percent={view.ring.percent}
              size={88}
              label={view.ring.label}
              tone="page"
              className="relative"
            />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <p
              data-testid="courses-progress-ring-done"
              className="break-words text-[15px] font-bold leading-snug text-text tabular-nums"
            >
              {view.ring.done}
            </p>
            <p
              data-testid="courses-progress-ring-sub"
              className="mt-1 break-words text-xs font-normal leading-relaxed text-text-secondary tabular-nums"
            >
              {view.ring.sub}
            </p>
          </div>
        </Card>

        {view.empty ? (
          <MemberEmptyCard
            icon={TrendingUp}
            data-testid="courses-progress-empty"
            className={cn('mx-4', !split && MEMBER_EMPTY_WIDE)}
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
          <Card
            data-testid="courses-progress-stats"
            className={cn(MEMBER_CARD, 'ms-panel mx-4 overflow-hidden rounded-3xl p-0')}
          >
            <dl className={STAT_GRID}>
              {view.stats.map((stat, index) => (
                <StatBlock
                  key={stat.key}
                  icon={STAT_ICON[stat.key]}
                  label={stat.label}
                  value={stat.value}
                  className={cn('border-border', STAT_BORDER[index])}
                />
              ))}
            </dl>
          </Card>
        ) : null}
      </div>

      {view.rows.length > 0 ? (
        <section data-testid="courses-progress-courses" className="flex flex-col pt-1">
          <MemberSectionHeader
            id="courses-progress-courses-title"
            title={t('courses.member.myProgress.courses.title')}
          />
          <ul aria-labelledby="courses-progress-courses-title" className={ROWS_LIST}>
            {view.rows.map((row, index) => (
              <li key={row.id} className="ms-rise min-w-0" style={riseStyle(index)}>
                <a
                  href={row.href}
                  aria-label={row.ariaLabel}
                  data-testid="courses-progress-row"
                  data-trailing={row.trailing}
                  className={`${ROW_CARD} ${FOCUS}`}
                >
                  <span
                    aria-hidden
                    className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-xl border border-border bg-bg-tertiary sm:w-32"
                  >
                    {row.coverAssetId ? (
                      <MediaImage
                        assetId={row.coverAssetId}
                        widths={PURPOSE_WIDTHS.cover}
                        alt=""
                        sizes="128px"
                        ratio=""
                        className="ms-zoom absolute inset-0 h-full w-full"
                        fallback={<CoverGradient />}
                      />
                    ) : (
                      <CoverGradient />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="line-clamp-1 break-words text-sm font-semibold text-text">
                      {row.title}
                    </span>
                    <ProgressBar
                      percent={row.bar.percent}
                      label={row.bar.label}
                      size="sm"
                      className="mt-2"
                    />
                    <span className="mt-1.5 text-xs font-normal text-text-tertiary tabular-nums">
                      {row.line}
                    </span>
                  </span>
                  {row.trailing === 'done' ? (
                    <span
                      aria-hidden
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success text-white"
                    >
                      <Check size={13} strokeWidth={3} />
                    </span>
                  ) : null}
                  {row.trailing === 'locked' ? (
                    <span
                      aria-hidden
                      className="ms-chip-surface flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-text-tertiary"
                    >
                      <Lock size={13} />
                    </span>
                  ) : null}
                  {row.trailing === 'chevron' ? (
                    <ChevronRight
                      aria-hidden
                      size={18}
                      className="shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                    />
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
