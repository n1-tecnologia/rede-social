import { RectangleHorizontal, RectangleVertical, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { COVER_SIZES, type CoverKind } from '@/lib/cover-sizes';

/**
 * 2026-10-23 — the ideal size of a cover, under every cover field (the product owner's request):
 * "Medida ideal: 1600 × 1200 px (4:3)" beside the glyph of its orientation, and, for a cover the app
 * also crops to another shape, the line asking to keep the subject in the middle. The numbers are
 * `COVER_SIZES`', the words `media.coverSize`'s. The numbers go in as strings: a number would be
 * formatted for pt-BR ("1.600").
 */
export function CoverSizeHint({ kind }: { kind: CoverKind }) {
  const t = useTranslations('media.coverSize');
  const size = COVER_SIZES[kind];
  const Icon =
    size.width > size.height
      ? RectangleHorizontal
      : size.width < size.height
        ? RectangleVertical
        : Square;
  return (
    <div data-cover-size={kind} className="flex items-start gap-1.5 text-xs">
      <Icon aria-hidden size={14} className="mt-px shrink-0 text-text-tertiary" />
      <p className="flex min-w-0 flex-col gap-0.5">
        <span className="font-semibold text-text-secondary">
          {t('ideal', {
            width: String(size.width),
            height: String(size.height),
            ratio: size.ratio,
          })}
        </span>
        {size.alsoOtherShapes ? (
          <span className="text-text-tertiary">{t(`notes.${kind}`)}</span>
        ) : null}
      </p>
    </div>
  );
}
