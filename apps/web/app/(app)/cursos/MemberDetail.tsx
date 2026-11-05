import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { ProgressBar } from '@rede-social/module-courses/ui';
import { cn, SkinTileFx } from '@rede-social/ui';
import { ChevronLeft, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * 2026-10-26 — the academy reference's detail pages (the user's "swap completo"): the course, the
 * module and the track open on the same hero and, under it, the same progress panel.
 *
 * `MemberDetailHero` is a rounded panel whose ground IS the cover, sunk under a dark wash from the
 * left (the words sit there) and at the foot; the title large and thin (the page's one h1, in the
 * tenant's title font, `data-brand-title`), a two-line description, a row of chips (`HeroChip`) and
 * the page's actions. A module page lays its name very large and faint behind the words
 * (`watermark`, decorative). From `md` a way back sits above the title (`back`); on a phone the
 * page's sticky `PageHeader` holds it. The words stay white in both themes: the ground is the dark
 * cover, as in the reference.
 *
 * Static: a sheet or a dialog never renders inside it (the buy zone sits under the hero), but the
 * hero still never moves or filters, like every member surface.
 */
export function MemberDetailHero({
  back,
  coverAssetId,
  eyebrow,
  title,
  description,
  chips,
  actions,
  watermark,
  testIds,
}: {
  /** The way back, shown from `md` (the phone's `PageHeader` holds it below). */
  back?: {
    href: string;
    label: string;
    /** Also on a phone (a page with no `PageHeader` there, like a track's page). */
    phone?: boolean;
    testId?: string;
  } | null;
  coverAssetId: string | null;
  /** A small uppercase line above the title ("Curso · 2 módulos · Iniciante"). */
  eyebrow?: string | null;
  title: string;
  description?: string | null;
  chips?: ReactNode;
  actions?: ReactNode;
  /** A module's name, drawn very large and faint behind the words. */
  watermark?: string | null;
  testIds: { root: string; title: string; description?: string; chips?: string };
}) {
  return (
    <section data-testid={testIds.root} className="md:px-4">
      <div className="ms-hero relative overflow-hidden border-border bg-bg-tertiary text-white md:rounded-3xl md:border">
        <span aria-hidden className="absolute inset-0 block">
          {coverAssetId ? (
            <MediaImage
              assetId={coverAssetId}
              widths={PURPOSE_WIDTHS.cover}
              alt=""
              sizes="(min-width: 1280px) 1232px, (min-width: 768px) calc(100vw - 320px), 100vw"
              eager
              ratio=""
              className="absolute inset-0 h-full w-full"
              fallback={<CoverWash />}
            />
          ) : (
            <CoverWash />
          )}
          <SkinTileFx />
          <span className="absolute inset-0 block bg-[linear-gradient(90deg,rgba(0,0,0,0.9)_0%,rgba(0,0,0,0.66)_42%,rgba(0,0,0,0.3)_100%)]" />
          <span className="absolute inset-0 block bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        </span>
        {watermark ? (
          <span
            aria-hidden
            className="ms-title-font pointer-events-none absolute inset-x-6 top-1/2 -translate-y-1/2 overflow-hidden whitespace-nowrap text-[clamp(4.5rem,13vw,10rem)] font-light uppercase leading-none tracking-tight text-white/[0.07] md:inset-x-10"
          >
            {watermark}
          </span>
        ) : null}

        <div className="relative flex min-h-[240px] flex-col justify-end gap-3 px-5 pt-16 pb-6 md:min-h-[300px] md:justify-center md:gap-4 md:px-10 md:py-10">
          {back ? (
            <a
              href={back.href}
              data-testid={back.testId}
              className={cn(
                'w-fit items-center gap-1 rounded-md text-sm font-medium text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
                back.phone ? 'inline-flex min-h-11 md:min-h-0' : 'hidden md:inline-flex',
              )}
            >
              <ChevronLeft aria-hidden size={16} className="shrink-0" />
              <span className="min-w-0 truncate">{back.label}</span>
            </a>
          ) : null}
          {eyebrow ? (
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70 tabular-nums [overflow-wrap:anywhere]">
              {eyebrow}
            </p>
          ) : null}
          <h1
            data-testid={testIds.title}
            data-brand-title
            className="ms-title-display max-w-3xl break-words text-3xl font-extrabold leading-tight tracking-tight text-white md:text-5xl"
          >
            {title}
          </h1>
          {description ? (
            <p
              data-testid={testIds.description}
              className="line-clamp-3 max-w-2xl text-sm font-normal leading-relaxed text-white/75 md:line-clamp-2 md:text-[15px]"
            >
              {description}
            </p>
          ) : null}
          {chips ? (
            <div data-testid={testIds.chips} className="flex flex-wrap items-center gap-2 pt-1">
              {chips}
            </div>
          ) : null}
          {actions ? (
            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap sm:items-center">
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** The tenant gradient behind a coverless hero, in the same box. */
function CoverWash() {
  return (
    <span
      aria-hidden
      className="absolute inset-0 block"
      style={{ backgroundImage: 'var(--brand-gradient)' }}
    />
  );
}

/**
 * One chip of a detail hero: glass over the cover with a leading glyph ("14 aulas", "3 concluídas"),
 * or the brand's (`tone="brand"`, "21% completo").
 */
export function HeroChip({
  icon: Icon,
  tone = 'glass',
  testId,
  children,
}: {
  icon?: LucideIcon;
  tone?: 'glass' | 'brand';
  testId?: string;
  children: ReactNode;
}) {
  return (
    <span
      data-testid={testId}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold text-white tabular-nums sm:text-[13px]',
        tone === 'brand'
          ? 'ms-chip-brand bg-brand/25 ring-1 ring-brand/40'
          : 'ms-chip bg-black/40 ring-1 ring-white/15',
      )}
    >
      {Icon ? <Icon aria-hidden size={14} className="shrink-0" /> : null}
      {children}
    </span>
  );
}

/**
 * "Seu progresso no curso / no módulo / na trilha" (the reference's panel under the hero): the
 * title, the bar and the share in the brand ink, and an optional helper line. A static glass panel.
 */
export function MemberProgressPanel({
  title,
  percent,
  barLabel,
  helper,
  testId,
}: {
  title: string;
  percent: number;
  /** The bar's accessible name ("{percent}% concluído"). */
  barLabel: string;
  helper?: string | null;
  testId?: string;
}) {
  const value = Math.min(100, Math.max(0, Math.round(Number.isFinite(percent) ? percent : 0)));
  return (
    <section
      data-testid={testId}
      className="ms-panel mx-4 flex flex-col gap-3 rounded-3xl border border-border bg-card p-5 md:p-6"
    >
      <p className="text-sm font-medium text-text-secondary">{title}</p>
      <div className="flex items-center gap-4">
        <ProgressBar percent={value} label={barLabel} size="md" className="min-w-0 flex-1" />
        <span className="shrink-0 text-lg font-semibold text-brand tabular-nums md:text-xl">
          {`${value}%`}
        </span>
      </div>
      {helper ? <p className="text-xs font-normal text-text-tertiary">{helper}</p> : null}
    </section>
  );
}

/**
 * A section title row of a detail page ("Módulos", "Aulas", "Cursos da trilha"): the title in the
 * skin's section size and, under it, an optional quiet line.
 */
export function MemberDetailSection({
  id,
  title,
  sub,
  children,
  testId,
}: {
  id: string;
  title: string;
  sub?: string | null;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section aria-labelledby={id} data-testid={testId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 px-4">
        <h2
          id={id}
          className="ms-title-section ms-title-font text-[17px] font-extrabold leading-tight tracking-tight text-text"
        >
          {title}
        </h2>
        {sub ? <p className="text-sm font-normal text-text-tertiary">{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** The detail pages' card grid: one card on a phone, two from 480px, three from `lg`, four at `xl`. */
export const DETAIL_GRID =
  'grid grid-cols-1 gap-4 px-4 min-[480px]:grid-cols-2 lg:grid-cols-3 lg:gap-5 xl:grid-cols-4';
