import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { MEDIA_CHIP } from '@rede-social/module-courses/ui';
import { SkinTileFx } from '@rede-social/ui';
import { User } from 'lucide-react';
import type { ReactNode } from 'react';

export interface CourseHeroProps {
  coverAssetId: string | null;
  coverAlt: string;
  /** The category, as the first glass chip; null without one. */
  category: string | null;
  /** More chips after the category (the store's "Exclusivo" on a locked course). */
  badges?: ReactNode;
  /** The line above the title ("Curso · 4 módulos · Iniciante"). */
  overline: string;
  title: string;
  instructorLine: string;
  instructorPhotoAssetId: string | null;
  /** A locked course: the art one step darker. Never grey (D-421 keeps the colour). */
  dimmed?: boolean;
  /**
   * 2026-10-26 (the member skin): a row of chips under the instructor (the member page's "{N}
   * aulas" and "{percent}% concluído", the academy reference's hero). The admin page passes none
   * and draws exactly what it did.
   */
  chips?: ReactNode;
  /** The page's own hooks, kept from the markup this hero replaced. */
  testIds: {
    root: string;
    fallback: string;
    tags?: string;
    overline?: string;
    title: string;
    instructor: string;
  };
  sizes?: string;
}

/**
 * 2026-10-22 — the course's full-bleed hero (the social-igoralves course page), shared by the
 * member's course page and the admin's: the cover edge to edge at 16:10 (the tenant gradient without
 * one) under a veil rising from the foot, the category and any badge as the area's 9px glass chips at
 * the top (the same chip as the store's compact "Exclusivo", so the two sit level), and
 * over the foot the overline, the title and the instructor with the 20px photo. The words over the
 * art are white on the veil in both themes; the title keeps the tenant's title font
 * (`data-brand-title`, whose ink rule skips `.text-white`), and stays a `p`: the page's h1 is the
 * header's.
 *
 * The 16:10 is a MINIMUM, not a crop: the art fills a clipped layer behind in-flow text, so a long
 * title, or a 320px screen, grows the hero instead of cutting the title. No hooks and no directive:
 * it renders inside the member's Server Component and the admin's client shell alike.
 *
 * 2026-10-23 (the wide desktop pages): from `md` the hero is a rounded card (the pages inset it by
 * the 16px gutter), and from `lg` it turns panoramic (21:9, a 16:10 hero on a 1232px column would be
 * 770px tall), with the words at a readable width and the title at 30px.
 */
export function CourseHero({
  coverAssetId,
  coverAlt,
  category,
  badges,
  overline,
  title,
  instructorLine,
  instructorPhotoAssetId,
  dimmed = false,
  chips,
  testIds,
  sizes = '(min-width: 1280px) 1232px, (min-width: 768px) calc(100vw - 320px), 100vw',
}: CourseHeroProps) {
  const gradient = { backgroundImage: 'var(--brand-gradient)' };
  const hasTags = category !== null || Boolean(badges);

  return (
    <div
      data-testid={testIds.root}
      className="ms-hero relative flex aspect-[16/10] w-full flex-col justify-end bg-bg-tertiary md:overflow-hidden md:rounded-2xl lg:aspect-[21/9]"
    >
      <div className="absolute inset-0 overflow-hidden">
        {coverAssetId ? (
          <MediaImage
            assetId={coverAssetId}
            widths={PURPOSE_WIDTHS.cover}
            alt={coverAlt}
            sizes={sizes}
            eager
            ratio=""
            className="absolute inset-0 h-full w-full"
            fallback={<span aria-hidden className="absolute inset-0 block" style={gradient} />}
          />
        ) : (
          <span
            aria-hidden
            data-testid={testIds.fallback}
            className="absolute inset-0 block"
            style={gradient}
          />
        )}
        <SkinTileFx />
        <span
          aria-hidden
          className="ms-hero-veil absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent"
        />
        {dimmed ? <span aria-hidden className="absolute inset-0 bg-black/25" /> : null}
      </div>

      {hasTags ? (
        <div
          data-testid={testIds.tags}
          className="absolute top-3 right-3 left-3 flex flex-wrap items-start gap-1.5"
        >
          {category ? <span className={MEDIA_CHIP}>{category}</span> : null}
          {badges}
        </div>
      ) : null}

      <div className="relative flex min-w-0 flex-col px-4 pt-14 pb-4 lg:max-w-3xl lg:px-8 lg:pb-8">
        <p
          data-testid={testIds.overline}
          className="text-[11px] font-bold uppercase tracking-wider text-white/80 tabular-nums [overflow-wrap:anywhere]"
        >
          {overline}
        </p>
        <p
          data-testid={testIds.title}
          data-brand-title
          className="ms-title-page mt-0.5 text-xl font-extrabold leading-snug tracking-tight text-white lg:mt-1 lg:text-3xl lg:leading-tight [overflow-wrap:anywhere]"
        >
          {title}
        </p>
        <p
          data-testid={testIds.instructor}
          className="mt-1.5 flex items-center gap-1.5 text-xs text-white/85 lg:mt-3 lg:text-sm"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/20">
            {instructorPhotoAssetId ? (
              <MediaImage
                assetId={instructorPhotoAssetId}
                widths={PURPOSE_WIDTHS.cover}
                alt=""
                sizes="20px"
                ratio=""
                className="h-full w-full"
              />
            ) : (
              <User aria-hidden size={12} className="text-white" />
            )}
          </span>
          <span className="min-w-0 break-words">{instructorLine}</span>
        </p>
        {chips ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 lg:mt-4">{chips}</div>
        ) : null}
      </div>
    </div>
  );
}
