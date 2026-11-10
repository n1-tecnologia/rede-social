import { MediaImage } from '@rede-social/core/ui';
import { cn } from '@rede-social/ui';
import { BookOpen } from 'lucide-react';

/**
 * Início's quick-access course card (2026-10-26, the academy reference's `home-course-card`; the
 * product owner: "quero que os cards sejam exatamente assim"): a small glass card (`ms-card
 * ms-panel`: the skin's lift, ring and sheen on hover, the press on click) holding the cover INSET
 * (4px all round, its own 12px corners, 1.22:1 on a phone, 1.6:1 from `sm`, 1.7:1 from `lg`, the art
 * zooming a little on hover), the title under it (13px, two lines kept) and, at the foot, a 2px line
 * of the member's share, always drawn (empty at 0%). No chips and no meta line: the accessible name
 * carries the lessons and the share, and `srLine` repeats the lessons for a screen reader, as the
 * reference does. Without a cover, or when it fails, a soft tint with a book glyph in the same box.
 *
 * ONE anchor; props only, no words (PWA-03, MOD-02): every string and the href come from the host.
 */
export interface MemberQuickCardProps {
  href: string;
  ariaLabel: string;
  title: string;
  coverAssetId: string | null;
  coverWidths: readonly number[];
  /** The image's `sizes` hint. */
  sizes?: string;
  /** 0–100: the line's fill. */
  percent: number;
  /** The line's accessible name ("21% concluído"). */
  percentLabel: string;
  /** For a screen reader only ("3/14 aulas"). */
  srLine?: string;
  eager?: boolean;
  /** The anchor's `data-testid`; `member-quick-card` by default. */
  testId?: string;
  /** The screen-reader line's `data-testid`. */
  srLineTestId?: string;
  className?: string;
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** Two cards a row on a phone, three, four and five as the row widens. */
const QUICK_SIZES = '(min-width: 1280px) 280px, (min-width: 640px) 30vw, 50vw';

export function MemberQuickCard({
  href,
  ariaLabel,
  title,
  coverAssetId,
  coverWidths,
  sizes = QUICK_SIZES,
  percent,
  percentLabel,
  srLine,
  eager = false,
  testId = 'member-quick-card',
  srLineTestId,
  className,
}: MemberQuickCardProps) {
  const share = Math.min(100, Math.max(0, Math.round(Number.isFinite(percent) ? percent : 0)));
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn(
        'ms-card ms-panel group flex min-h-[154px] flex-col overflow-hidden rounded-2xl border border-border bg-card p-1 pb-2.5 transition-opacity active:opacity-90',
        FOCUS,
        className,
      )}
    >
      <div
        aria-hidden
        data-testid="member-quick-card-cover"
        className="relative aspect-[1.22/1] w-full overflow-hidden rounded-xl bg-gradient-to-br from-bg-tertiary via-bg-tertiary to-brand/10 sm:aspect-[1.6/1] lg:aspect-[1.7/1]"
      >
        <BookOpen
          size={20}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-text-tertiary"
        />
        {coverAssetId ? (
          <MediaImage
            assetId={coverAssetId}
            widths={coverWidths}
            alt=""
            sizes={sizes}
            eager={eager}
            ratio=""
            className="ms-zoom absolute inset-0 h-full w-full"
            // A failed cover leaves the tint and the glyph under it.
            // The value is false, not null or undefined: MediaImage replaces a nullish
            // fallback with its own tinted span, which would cover the glyph. False draws
            // nothing, as the empty fragment did.
            fallback={false}
          />
        ) : null}
      </div>
      <h3
        data-testid="member-quick-card-title"
        className="ms-title-font mt-2 line-clamp-2 min-h-9 px-1.5 text-[13px] font-medium leading-[18px] tracking-[-0.02em] text-text"
      >
        {title}
      </h3>
      <div className="mt-auto px-1.5 pt-1.5">
        {srLine ? (
          <span data-testid={srLineTestId} className="sr-only">
            {srLine}
          </span>
        ) : null}
        <div
          role="progressbar"
          aria-valuenow={share}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={percentLabel}
          className="h-0.5 overflow-hidden rounded-full bg-border"
        >
          <div className="h-full rounded-full bg-brand/80" style={{ width: `${share}%` }} />
        </div>
      </div>
    </a>
  );
}
