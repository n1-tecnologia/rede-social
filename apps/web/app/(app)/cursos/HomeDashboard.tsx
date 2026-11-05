import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { ProgressBar } from '@rede-social/module-courses/ui';
import { cn, SkinAmbient } from '@rede-social/ui';
import {
  ChartPie,
  ChevronRight,
  CircleCheck,
  Flame,
  GraduationCap,
  type LucideIcon,
  Play,
  PlayCircle,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { HomePromoView, HomeStatsView } from '@/lib/courses-home-view';
import type { HomeHeroView, NewLessonView } from '@/lib/courses-member-view';
import { HomePromoBody } from './HomePromoBody';
import { CoverGradient } from './MemberSection';

/** The resume section's id: the floating "Continuar assistindo" card watches it. */
export const HOME_RESUME_ID = 'courses-home-hero';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * Início's dashboard panel (2026-10-26, the academy reference's one large panel, made "mais fiel"
 * by the product owner): ONE glass panel split by hairlines, with the brand's ambient light drifting
 * behind it (`SkinAmbient`, as the bento's large tile; `isolate` keeps it under the words, and
 * nothing in the panel opens a sheet):
 *
 *  - the numbers strip (`HomeStats`), two cells a row on a phone and four from `lg`;
 *  - under it, from `lg`, two halves: at the left "Continue de onde parou" (`HomeResume`) over
 *    "Últimas aulas" (`HomeLatest`), at the right the promotion (`HomePromo`: the moving image
 *    collage and its invitation). On a phone, one under the other.
 *
 * The host omits any part it has no data for; the left half alone spans the panel.
 */
export function HomeDashboard({
  stats,
  resume,
  latest,
  promo,
}: {
  stats: ReactNode;
  resume: ReactNode;
  latest: ReactNode;
  promo: ReactNode;
}) {
  const left = resume !== null || latest !== null;
  return (
    <div className="px-4">
      <div
        data-testid="courses-home-panel"
        className="ms-panel relative isolate flex flex-col overflow-hidden rounded-3xl border border-border bg-card"
      >
        <SkinAmbient />
        {stats}
        {left || promo ? (
          <div
            className={cn(
              'grid grid-cols-1 divide-y divide-border',
              stats !== null && 'border-t border-border',
              left && promo && 'lg:grid-cols-2 lg:divide-x lg:divide-y-0',
            )}
          >
            {left ? (
              <div className="flex min-w-0 flex-col divide-y divide-border">
                {resume}
                {latest}
              </div>
            ) : null}
            {promo}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A cell's borders: two a row on a phone, four from `lg` (the hairlines between them). */
const CELL_EDGES = [
  'border-r border-b lg:border-b-0',
  'border-b lg:border-b-0 lg:border-r',
  'border-r',
  '',
] as const;

function StatCell({
  index,
  label,
  icon: Icon,
  children,
  className,
  testId,
}: {
  index: number;
  label: string;
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'flex min-h-[128px] min-w-0 flex-col border-border p-5 lg:min-h-[152px] lg:px-8 lg:py-7',
        CELL_EDGES[index],
        className,
      )}
    >
      <dt className="flex items-start justify-between gap-2 text-[10px] font-medium uppercase leading-snug tracking-[0.14em] text-text-tertiary">
        <span className="line-clamp-2 min-w-0 break-words">{label}</span>
        <Icon aria-hidden size={14} className="shrink-0" />
      </dt>
      <dd className="flex min-w-0 flex-1 flex-col pt-5">{children}</dd>
    </div>
  );
}

const VALUE = 'text-2xl font-semibold leading-none tracking-tight text-text tabular-nums';
/** Under the value, pushed to the cell's foot: the values of the four cells share one line. */
const FOOT = 'mt-auto flex flex-col pt-3';
const LINE = 'mt-2 text-[11px] font-normal leading-snug text-text-tertiary';

/**
 * The numbers strip (the reference's "Progresso geral · Aulas · …"): the member's overall share with
 * its bar, the lessons completed, the study streak (display only, D-443: no nudge is built on it)
 * and the courses completed, a link to Progresso over the whole cell. Every number the server's.
 */
export function HomeStats({
  view,
  labels,
}: {
  view: HomeStatsView;
  labels: { region: string; progress: string; lessons: string; streak: string; courses: string };
}) {
  return (
    <dl
      data-testid="courses-home-stats"
      aria-label={labels.region}
      className="grid grid-cols-2 lg:grid-cols-4"
    >
      <StatCell
        index={0}
        label={labels.progress}
        icon={ChartPie}
        testId="courses-home-stat-progress"
      >
        <span className={VALUE}>{view.progress.value}</span>
        <span className={FOOT}>
          <ProgressBar percent={view.progress.percent} label={view.progress.barLabel} size="sm" />
          <span className={LINE}>{view.progress.line}</span>
        </span>
      </StatCell>
      <StatCell
        index={1}
        label={labels.lessons}
        icon={PlayCircle}
        testId="courses-home-stat-lessons"
      >
        <span className={VALUE}>{view.lessons.value}</span>
        <span className={FOOT}>
          <span className={LINE}>{view.lessons.line}</span>
        </span>
      </StatCell>
      <StatCell index={2} label={labels.streak} icon={Flame}>
        <span
          role="img"
          aria-label={view.streak.ariaLabel}
          data-testid="courses-member-streak"
          data-active={view.streak.active}
          className="flex flex-1 flex-col"
        >
          <span className={cn(VALUE, view.streak.active && 'text-brand')}>{view.streak.value}</span>
          <span className={FOOT}>
            <span className={LINE}>{view.streak.line}</span>
          </span>
        </span>
      </StatCell>
      <StatCell
        index={3}
        label={labels.courses}
        icon={GraduationCap}
        testId="courses-home-stat-courses"
        className="group relative transition-colors hover:bg-bg-hover"
      >
        <span className={VALUE}>{view.courses.value}</span>
        <a
          href={view.courses.href}
          className="mt-auto inline-flex w-fit items-center gap-0.5 pt-5 text-[11px] font-semibold text-brand after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-brand"
        >
          {view.courses.line}
          <ChevronRight
            aria-hidden
            size={12}
            className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        </a>
      </StatCell>
    </dl>
  );
}

/**
 * "Continue de onde parou" (the overview's hero, D-437, UI-D-449; the reference's resume card): the
 * state's title ("Continue de onde parou", "Comece por aqui", "Você está em dia"), "Retome seus
 * estudos" when resuming, and ONE card: the COURSE cover at 16:9 (the lesson's "mm:ss" and "Aula
 * aberta" on it, the play disc on hover), the lesson's place ("{course} · Módulo 01 · Aula 02"), its
 * title and the CTA in the brand's ink, a link stretched over the whole card (the card has no other
 * target). Every word arrives from `homeHeroView`; the old hero's hooks stay (`courses-home-hero-*`).
 */
export function HomeResume({ view, sub }: { view: HomeHeroView; sub: string | null }) {
  return (
    <section
      id={HOME_RESUME_ID}
      data-testid="courses-home-hero"
      data-home-section
      aria-labelledby="courses-home-hero-heading"
      className="flex min-w-0 flex-col p-6 lg:p-8"
    >
      <h2
        id="courses-home-hero-heading"
        className="ms-title-font text-xl font-medium leading-tight tracking-tight text-text lg:text-[22px]"
      >
        {view.sectionTitle}
      </h2>
      {sub ? <p className="mt-1 text-sm font-normal text-text-tertiary">{sub}</p> : null}

      <div className="ms-card ms-panel ms-solid group relative mt-4 flex gap-4 rounded-xl border border-border bg-card p-2.5">
        <div className="relative aspect-video w-32 shrink-0 self-start overflow-hidden rounded-lg bg-bg-tertiary sm:w-44">
          {view.coverAssetId ? (
            <MediaImage
              assetId={view.coverAssetId}
              widths={PURPOSE_WIDTHS.cover}
              alt=""
              sizes="(min-width: 640px) 176px, 128px"
              ratio=""
              className="ms-zoom absolute inset-0 h-full w-full"
              fallback={<CoverGradient />}
            />
          ) : (
            <CoverGradient />
          )}
          <span
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"
          />
          {view.badge ? (
            <span
              data-testid="courses-home-hero-badge"
              className="ms-chip absolute top-1.5 left-1.5 max-w-[calc(100%-0.75rem)] truncate rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
            >
              {view.badge}
            </span>
          ) : null}
          {view.duration ? (
            <span
              data-testid="courses-home-hero-duration"
              className="ms-chip absolute right-1.5 bottom-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums"
            >
              {view.duration}
            </span>
          ) : null}
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 motion-reduce:transition-none"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/15 text-white backdrop-blur-md">
              <Play size={15} fill="currentColor" className="ml-0.5" />
            </span>
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center">
          {view.eyebrow ? (
            <span
              data-testid="courses-home-hero-eyebrow"
              className="line-clamp-1 text-[11px] font-normal text-text-tertiary tabular-nums"
            >
              {view.eyebrow}
            </span>
          ) : null}
          <h3
            data-testid="courses-home-hero-title"
            className="mt-1 line-clamp-2 break-words text-sm font-medium leading-snug text-text"
          >
            {view.title}
          </h3>
          <a
            href={view.cta.href}
            data-testid="courses-home-hero-cta"
            className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full text-[12px] font-medium text-brand transition-colors after:absolute after:inset-0 after:rounded-[inherit] hover:text-brand-hover focus-visible:outline-none focus-visible:after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-brand"
          >
            {view.cta.play ? (
              <Play aria-hidden size={12} fill="currentColor" className="shrink-0" />
            ) : null}
            {view.cta.label}
          </a>
        </div>
      </div>
    </section>
  );
}

/**
 * "Últimas aulas" (COURSE-33, UI-D-454; the reference's list): up to four lessons the SERVER says
 * the member can open, in its order, as text rows between hairlines (the lesson's title, "{course} ·
 * {duration}", the success check once done, else a chevron), and the way to the whole catalogue
 * under them. Each row is one link to the lesson; the old rail's hooks stay
 * (`courses-home-new-lesson*`).
 */
export function HomeLatest({
  items,
  title,
  sub,
  all,
}: {
  items: NewLessonView[];
  title: string;
  sub: string;
  all: { href: string; label: string };
}) {
  return (
    <section
      data-testid="courses-home-new-lessons"
      data-home-section
      aria-labelledby="courses-home-new-lessons-title"
      className="flex min-w-0 flex-1 flex-col p-6 lg:p-8"
    >
      <h2
        id="courses-home-new-lessons-title"
        className="ms-title-font text-xl font-medium leading-tight tracking-tight text-text lg:text-[22px]"
      >
        {title}
      </h2>
      <p className="mt-1 text-sm font-normal text-text-tertiary">{sub}</p>
      <ul
        aria-labelledby="courses-home-new-lessons-title"
        className="mt-4 flex flex-col divide-y divide-border"
      >
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={item.href}
              aria-label={item.ariaLabel}
              data-testid="courses-home-new-lesson"
              data-done={item.done}
              className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span
                  data-testid="courses-home-new-lesson-title"
                  className="line-clamp-1 break-words text-sm font-medium text-text"
                >
                  {item.title}
                </span>
                <span className="mt-0.5 line-clamp-1 text-[11px] font-normal text-text-tertiary tabular-nums">
                  {item.meta}
                </span>
              </span>
              {item.done ? (
                <CircleCheck aria-hidden size={16} className="shrink-0 text-success" />
              ) : (
                <ChevronRight
                  aria-hidden
                  size={16}
                  className="shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                />
              )}
            </a>
          </li>
        ))}
      </ul>
      <a
        href={all.href}
        data-testid="courses-home-new-lessons-all"
        className={`mt-4 inline-flex w-fit items-center gap-1 rounded-md text-xs font-medium text-text-secondary transition-colors hover:text-text ${FOCUS}`}
      >
        {all.label}
        <ChevronRight aria-hidden size={13} className="shrink-0" />
      </a>
    </section>
  );
}

/** The collage's columns: five, each scrolling its images up or down for ever. */
const COLUMNS = 5;
const PER_COLUMN = 5;

/**
 * The promotion at the panel's right (the reference's "Você foi convidado para o AXIS"): a collage
 * of the school's images in five tilted columns that scroll for ever, alternately up and down
 * (`ms-marquee-up` / `ms-marquee-down`, still under "reduzir movimento"), under a dark veil, and the
 * invitation centred over it: the eyebrow, the title, the line, the chips and ONE white CTA, a link
 * (the store's newest active product, or the catalogue). Always dark, in both themes, like the
 * reference. Every word and every image id arrives from `homePromoView`. `body` replaces the
 * invitation for the administrator (`HomePromoChoice`: the same words, a product of their pick and
 * the pencil that opens the picker); without it the invitation is `HomePromoBody`.
 */
export function HomePromo({
  view,
  body,
  compact = false,
}: {
  view: HomePromoView;
  body?: ReactNode;
  /** Beside "Últimas aulas" alone (the hero went to the top): the shorter height from `lg` too. */
  compact?: boolean;
}) {
  const columns = Array.from({ length: COLUMNS }, (_, column) =>
    Array.from(
      { length: PER_COLUMN },
      (_, row) => view.images[(column * PER_COLUMN + row * 3 + column) % view.images.length],
    ).filter((id): id is string => typeof id === 'string'),
  );
  return (
    <section
      data-testid="courses-home-promo"
      data-home-section
      data-kind={view.kind}
      aria-labelledby="courses-home-promo-title"
      className={cn(
        'relative isolate flex min-h-[440px] min-w-0 flex-col overflow-hidden bg-black text-white',
        !compact && 'lg:min-h-[540px]',
      )}
    >
      {view.images.length > 0 ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex -rotate-[10deg] scale-[1.35] gap-2.5"
        >
          {columns.map((column, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: four fixed, decorative columns.
              key={index}
              className="relative h-full flex-1 overflow-hidden"
            >
              <div
                className={cn(
                  'flex flex-col gap-2.5',
                  index % 2 === 0 ? 'ms-marquee-up' : 'ms-marquee-down',
                )}
              >
                {[...column, ...column].map((assetId, row) => (
                  <MediaImage
                    // biome-ignore lint/suspicious/noArrayIndexKey: a column repeats its images.
                    key={`${assetId}-${row}`}
                    assetId={assetId}
                    widths={PURPOSE_WIDTHS.cover}
                    alt=""
                    sizes="200px"
                    ratio=""
                    className="aspect-[4/5] w-full shrink-0 rounded-lg object-cover"
                    fallback={<span className="block aspect-[4/5] w-full rounded-lg bg-white/10" />}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_50%,rgba(0,0,0,0.78)_0%,rgba(0,0,0,0.55)_55%,rgba(0,0,0,0.35)_100%)]"
      />

      {body ?? <HomePromoBody view={view} />}
    </section>
  );
}
