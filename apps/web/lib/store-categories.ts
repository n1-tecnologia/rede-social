import {
  cleanCategoryName,
  guessStoreCategory,
  plainText,
  STORE_BUILT_IN_CATEGORIES,
  STORE_PRODUCT_CATEGORIES,
  type StoreCategoryIcon,
  type StoreFront,
  type StoreFrontCategory,
  type StoreProductCategory,
} from '@rede-social/module-store/contracts';

/**
 * The store's categories (2026-10-27, the product owner: "será vendido curso, livro, roupa,
 * perfumes, equipamentos e afins"): the storefront's tiles and shelves, in the store's own order.
 * The slug is the `?categoria=` of the category's page.
 *
 * Since 12.3 (D-690, D-691) the categories are the STORE's rows, read from `GET /v1/store/front`
 * (`getStoreFront`); the eight below are only the seed the API plants once per store and the list
 * "Restaurar as categorias padrão" returns the draft to. The pure helpers here (the chip tag, the
 * ids, the built-in list) used to live in the retired per-device cookie library.
 */
export const STORE_CATEGORIES = STORE_PRODUCT_CATEGORIES;
export type StoreCategory = StoreProductCategory;

export function isStoreCategory(value: unknown): value is StoreCategory {
  return typeof value === 'string' && (STORE_CATEGORIES as readonly string[]).includes(value);
}

export type { StoreCategoryIcon };
/**
 * The name guess and the name rule live in the store contract (12.3-11, D-692): ONE rule, the
 * server's. Re-exported here under the same names so the web's callers keep working; the guess only
 * pre-selects the product form's field, the storefront never applies it (D-693).
 */
export { cleanCategoryName, guessStoreCategory, plainText };

/** A category as the sheet and the screens keep it: its slug, its name and its glyph. */
export interface StoreCategoryDef {
  id: string;
  name: string;
  icon: StoreCategoryIcon;
}

/** A category as the screens show it: its name (the tile, the shelf), its chip and its glyph. */
export interface StoreCategoryView extends StoreCategoryDef {
  /** The card's chip: a built-in category's singular ("Livro"), else its own name. */
  tag: string;
}

type Translate = (key: string) => string;

/** The built-in eight (the server's seed), with their own slugs: what a reset puts in the draft. */
export function builtInCategories(): StoreCategoryDef[] {
  return STORE_BUILT_IN_CATEGORIES.map(({ slug, name, icon }) => ({ id: slug, name, icon }));
}

/** The store's category slugs, in its order (the `?categoria=` the storefront accepts). */
export function storeCategoryIds(front: StoreFront | null): string[] {
  return front?.categories.map((category) => category.id) ?? [];
}

/** The API's categories, in the store's order, as the screens show them (`t` reads the full key). */
export function storeCategoryList(
  categories: readonly StoreFrontCategory[],
  t: Translate,
): StoreCategoryView[] {
  return categories.map(({ id, name, icon }) => ({
    id,
    name,
    icon,
    tag:
      isStoreCategory(id) && name === t(`store.categories.names.${id}`)
        ? t(`store.categories.tags.${id}`)
        : name,
  }));
}
