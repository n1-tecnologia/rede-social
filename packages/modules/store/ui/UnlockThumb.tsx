import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';

/**
 * The thumb of one thing a product unlocks (08.5-12, UI-D-439, UI-D-440): the product page's
 * "Libera o acesso a" rows and the "Compra concluída" list draw the SAME box per kind:
 *  - `square` — a community, 32px `rounded-lg` (the 08.2 thumb, byte for byte);
 *  - `poster` — a course, `w-8 aspect-[3/4]` (the catalogue's 3:4 poster);
 *  - `wide` — a live, `w-12 aspect-[16/10]` (the live card's frame).
 * The cover, or the tenant gradient when there is none or it fails to load (D-69). Decorative
 * (`aria-hidden`): the row's name says what it is. Props only, no words.
 */
export type UnlockThumbRatio = 'square' | 'poster' | 'wide';

export interface UnlockThumbProps {
  assetId: string | null;
  ratio: UnlockThumbRatio;
}

/** The square's classes are the 08.2 community thumb's, verbatim. */
const GRADIENT_BOX: Record<UnlockThumbRatio, string> = {
  square: 'block h-8 w-8 shrink-0 rounded-lg',
  poster: 'block aspect-[3/4] w-8 shrink-0 rounded-lg',
  wide: 'block aspect-[16/10] w-12 shrink-0 rounded-lg',
};

const IMAGE_BOX: Record<UnlockThumbRatio, string> = {
  square: 'block h-8 w-8 shrink-0 overflow-hidden rounded-lg',
  poster: 'block aspect-[3/4] w-8 shrink-0 overflow-hidden rounded-lg',
  wide: 'block aspect-[16/10] w-12 shrink-0 overflow-hidden rounded-lg',
};

const SIZES: Record<UnlockThumbRatio, string> = {
  square: '32px',
  poster: '32px',
  wide: '48px',
};

export function UnlockThumb({ assetId, ratio }: UnlockThumbProps) {
  const gradient = (
    <span
      aria-hidden
      className={GRADIENT_BOX[ratio]}
      style={{ backgroundImage: 'var(--brand-gradient)' }}
    />
  );
  if (assetId === null) return gradient;
  return (
    <span aria-hidden className={IMAGE_BOX[ratio]}>
      <MediaImage
        assetId={assetId}
        widths={PURPOSE_WIDTHS.cover}
        alt=""
        sizes={SIZES[ratio]}
        ratio=""
        className="h-full w-full"
        fallback={gradient}
      />
    </span>
  );
}
