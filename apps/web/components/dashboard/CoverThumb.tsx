import type { ContentKind } from '@rede-social/module-dashboard/fixtures';
import { cn } from '@rede-social/ui';
import {
  Aperture,
  BookOpen,
  GalleryHorizontal,
  GraduationCap,
  Image as ImageIcon,
  Link2,
  type LucideIcon,
  MapPin,
  MonitorPlay,
  Play,
  ShoppingBag,
  Ticket,
  Type,
  Users,
  Video,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { type DashboardT, formatClock } from './format';

/**
 * A publication's kind, plus the two strong actions that are not publications (PD-D), the store's
 * products and the events' formats (quick 261014-ia8 F-7).
 */
export type CoverKind =
  | ContentKind
  | 'event'
  | 'order'
  | 'community'
  | 'mentoring'
  | 'ebook'
  | 'recorded'
  | 'in_person'
  | 'online';

/** One icon per kind, shared by the list thumbnail and the content cover (D-02). */
export const COVER_ICON: Record<CoverKind, LucideIcon> = {
  video: Play,
  photo: ImageIcon,
  carousel: GalleryHorizontal,
  text: Type,
  link: Link2,
  story: Aperture,
  event: Ticket,
  order: ShoppingBag,
  community: Users,
  mentoring: GraduationCap,
  ebook: BookOpen,
  recorded: MonitorPlay,
  in_person: MapPin,
  online: Video,
};

/** The five angles of the brand pair: the tones a cover can take (quick 261013-uoi PD-I). */
export const COVER_TONES = [0, 72, 144, 216, 288] as const;

/** How much of the primary each tone keeps (the rest is the brand's dark ink): light to deep. */
const COVER_DEPTH = [100, 62, 84, 48, 72] as const;

/**
 * The cover's tone for a publication: the sum of its id's character codes picks one of the five
 * angles, so the same publication has the same tone everywhere and neighbours rarely match.
 */
export function coverTone(seed: string): (typeof COVER_TONES)[number] {
  let sum = 0;
  for (const char of seed) sum += char.charCodeAt(0);
  return COVER_TONES[sum % COVER_TONES.length] ?? COVER_TONES[0];
}

/**
 * The cover's paint: the brand's primary and secondary turned by the publication's angle, so the
 * tones read apart (the shifted shared gradient barely did, F-6) and never leave the brand tokens.
 */
export function coverStyle(seed: string): CSSProperties {
  // The brand pair can be two close blues, so the angle alone barely shows (flow review of uoi):
  // each angle also gets its own depth, the primary mixed toward the brand's dark ink.
  const tone = coverTone(seed);
  const depth = COVER_DEPTH[COVER_TONES.indexOf(tone)] ?? 100;
  return {
    backgroundImage: `linear-gradient(${tone}deg, color-mix(in oklch, var(--brand-primary) ${depth}%, var(--brand-on-primary-dark)), var(--brand-secondary))`,
    color: 'var(--brand-on-primary)',
  };
}

export interface CoverThumbProps {
  kind: CoverKind;
  /** The publication's (or event's, or product's) id: picks the tone. */
  seed: string;
  /** A video's length, drawn as a small badge. */
  durationSeconds?: number | null;
  /**
   * `row`: a 56 px square at the start of a list row; `card`: the compact card's cover (E-01);
   * `strip`: a low full-width band on top of a list card; `banner`: a full-width 16:7 header cover.
   * The last two have no corners of their own: the card around them clips them.
   */
  variant?: 'row' | 'card' | 'strip' | 'banner';
  /** `card` only: the feed's width ÷ height (`contentCoverRatio`); null (a text post) is square. */
  ratio?: number | null;
}

/**
 * The compact card's cover (quick 261013-uoi F-3): a fixed 4.5rem column, so the card's text keeps
 * the same width on every card; the cover is as wide as 7rem of height allows, never wider than the
 * column, its height from the ratio.
 */
const CARD_COLUMN_REM = 4.5;
const CARD_HEIGHT_REM = 7;

/**
 * The publication's cover as a thumbnail (quick 261013-orf D-02): 56 px at the start of a list row,
 * the "Sua atividade" look, or the compact card's cover in its column (E-01, quick 261013-uoi F-3).
 * The same brand cover as Conteúdo's detail, with the kind's icon and a video's length; a story is a
 * circle with the brand ring, as on Instagram (F-5). Decorative (D-04): the row's text stays its
 * accessible name. With real data this becomes the post's media (`MediaImage`); the gradient stays
 * for posts without media.
 */
export function CoverThumb({
  t,
  kind,
  seed,
  durationSeconds = null,
  variant = 'row',
  ratio = null,
}: CoverThumbProps & { t: DashboardT }) {
  const Icon = COVER_ICON[kind];
  if (variant === 'strip' || variant === 'banner') {
    return (
      <span
        aria-hidden="true"
        data-testid="cover-thumb"
        data-kind={kind}
        data-tone={coverTone(seed)}
        className={cn(
          'flex w-full shrink-0 items-center justify-center overflow-hidden',
          variant === 'strip' ? 'h-16' : 'aspect-[16/7]',
        )}
        style={coverStyle(seed)}
      >
        <Icon size={variant === 'strip' ? 28 : 44} className="opacity-90" />
      </span>
    );
  }
  const card = variant === 'card';
  const story = kind === 'story';
  const aspect = story ? 1 : (ratio ?? 1);
  // A landscape card cover is only ~2.5rem high: the icon moves left of the length badge, smaller.
  const wide = card && aspect > 1;
  const cover = (
    <span
      aria-hidden="true"
      data-testid="cover-thumb"
      data-kind={kind}
      data-tone={coverTone(seed)}
      data-ratio={card ? String(aspect) : undefined}
      className={cn(
        'relative flex shrink-0 items-center overflow-hidden',
        wide ? 'justify-start pl-1.5' : 'justify-center',
        story ? 'rounded-full ring-2 ring-brand ring-offset-2 ring-offset-card' : 'rounded-lg',
        !card && 'size-14',
      )}
      style={
        card
          ? {
              ...coverStyle(seed),
              aspectRatio: aspect,
              // Computed here: the test DOM drops CSS `min()`.
              width: `${Math.min(CARD_COLUMN_REM, CARD_HEIGHT_REM * aspect).toFixed(3)}rem`,
            }
          : coverStyle(seed)
      }
    >
      <Icon size={wide ? 18 : card ? 28 : 24} className="opacity-90" />
      {durationSeconds !== null ? (
        <span
          className={cn(
            'absolute rounded bg-black/50 font-bold tabular-nums text-white',
            wide && 'right-1 bottom-1 px-1 text-xs leading-4',
            card && !wide && 'right-1.5 bottom-1.5 px-1.5 py-0.5 text-xs',
            !card && 'right-1 bottom-1 px-1 text-[10px] leading-4',
          )}
        >
          {formatClock(t, durationSeconds)}
        </span>
      ) : null}
    </span>
  );
  return card ? <span className="flex w-[4.5rem] shrink-0 justify-center">{cover}</span> : cover;
}
