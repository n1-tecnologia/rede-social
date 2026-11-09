import {
  guessStoreCategory,
  STORE_PRODUCT_CATEGORIES,
  type StoreProductCategory,
} from '@rede-social/module-store/contracts';

/**
 * The store's categories (2026-10-27, the product owner: "será vendido curso, livro, roupa,
 * perfumes, equipamentos e afins"): the storefront's tiles and shelves, in this order. The slug is
 * the `?categoria=` of the category's page.
 */
export const STORE_CATEGORIES = STORE_PRODUCT_CATEGORIES;
export type StoreCategory = StoreProductCategory;

export function isStoreCategory(value: unknown): value is StoreCategory {
  return typeof value === 'string' && (STORE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The name guess moved to the store contract (12.3-11, D-692): ONE rule, the server's, applied on a
 * create that sends no category and pinned to the shared corpus of the store module. Re-exported here
 * under the same names so the web's callers and its own test keep working until the storefront reads
 * the API's category (the web plans of this phase remove the name-guess fallback, D-693).
 */
export { guessStoreCategory, plainText } from '@rede-social/module-store/contracts';

/** The product's category: the API's when it sends one, else the name's (the temporary rule). */
export function productCategory(product: {
  name: string;
  category?: StoreCategory | undefined;
}): StoreCategory {
  return product.category ?? guessStoreCategory(product.name);
}
