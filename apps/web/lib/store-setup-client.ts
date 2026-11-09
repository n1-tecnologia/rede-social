import {
  encodeAssignments,
  encodeStoreSetup,
  parseAssignments,
  productKey,
  STORE_ASSIGN_COOKIE,
  STORE_SETUP_COOKIE,
  type StoreSetup,
} from '@/lib/store-setup';

/**
 * The store's setup written on THIS device (`lib/store-setup.ts`), from the browser. A year's life,
 * the whole site's path, `samesite=lax`; `secure` on https. An empty value forgets the cookie.
 */
function writeCookie(name: string, value: string): void {
  const secure = location.protocol === 'https:' ? '; secure' : '';
  const life = value === '' ? 'max-age=0' : 'max-age=31536000';
  // biome-ignore lint/suspicious/noDocumentCookie: the theme's reason (`ThemeToggle`): the Cookie Store API is not available on every supported mobile browser; this is a per-device preference
  document.cookie = `${name}=${value}; path=/; ${life}; samesite=lax${secure}`;
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const piece = part.trim();
    if (piece.startsWith(prefix)) return piece.slice(prefix.length);
  }
  return null;
}

/** Keeps the categories and "Em destaque"; the built-in store with no featured list forgets it. */
export function saveStoreSetup(setup: StoreSetup): void {
  const plain = setup.categories === null && setup.featured.length === 0;
  writeCookie(STORE_SETUP_COOKIE, plain ? '' : encodeStoreSetup(setup));
}

/** Keeps one product's category (`NO_CATEGORY` for none); `null` returns it to its name's guess. */
export function saveProductCategory(productId: string, categoryId: string | null): void {
  const assignments = parseAssignments(readCookie(STORE_ASSIGN_COOKIE));
  const key = productKey(productId);
  if (categoryId === null) assignments.delete(key);
  else assignments.set(key, categoryId);
  writeCookie(STORE_ASSIGN_COOKIE, encodeAssignments(assignments));
}

/** Drops a removed category from every product that had it (they fall back to no category). */
export function forgetCategory(categoryId: string): void {
  const assignments = parseAssignments(readCookie(STORE_ASSIGN_COOKIE));
  for (const [key, category] of assignments) {
    if (category === categoryId) assignments.delete(key);
  }
  writeCookie(STORE_ASSIGN_COOKIE, encodeAssignments(assignments));
}
