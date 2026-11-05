import type { HomePromoView } from './courses-home-view';

/**
 * The store's product in Início's panel, picked by the administrator (2026-10-27, front only).
 *
 * By default the promotion is the store's NEWEST active product (the API lists them newest first).
 * The API has no field for a featured product yet, so the administrator's pick lives in a PER-DEVICE
 * cookie, like the admin's icon (`lib/admin-icon.ts`) and the theme's `rede_theme` (D-41): the
 * product's id, per origin (one tenant per origin), written by the picker (`HomePromoChoice`) and
 * read on the server, so the first HTML already draws the picked product. It only changes what an
 * administrator sees on THIS device: a member is always shown the default, and an id that is not an
 * active product any more falls back to it. Never used for authorisation.
 */
export const HOME_PROMO_COOKIE = 'rede_home_promo';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The cookie's value back as a product id; anything malformed is `null` (the default). */
export function parseHomePromoChoice(raw: string | null | undefined): string | null {
  return raw && UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

/** One product the promotion can show: its id, its name and its price, already worded. */
export interface HomePromoProduct {
  id: string;
  name: string;
  price: string;
}

/**
 * The promotion with `product` in it: its name, its price and its page, exactly as `homePromoView`
 * builds it on the server. The eyebrow, the line, the CTA's words and the collage stay the view's
 * (the same for every product).
 */
export function promoWithProduct(view: HomePromoView, product: HomePromoProduct): HomePromoView {
  return {
    ...view,
    kind: 'product',
    title: product.name,
    chips: [product.price],
    cta: { href: `/loja/${encodeURIComponent(product.id)}`, label: view.cta.label },
  };
}
