import { guessStoreCategory, STORE_CATEGORIES, type StoreCategory } from '@/lib/store-categories';

/**
 * 2026-10-28 — the store's setup made in Gerenciar (the product owner: "na tela de gerenciar da
 * parte de loja quero que tenha como gerenciar as categorias e o destaque" and "esta parte de
 * escolher categoria deve ser um menu dropdown com as categorias que o user criou"): the categories
 * (name, glyph, order), each product's category and the products of "Em destaque".
 *
 * ⚠ Front only until the API keeps them (the product has no category, the store no featured list):
 * two cookies on THIS device, as the Início's "Destaque da loja" (`lib/home-promo.ts`). One holds
 * the categories and the featured products (base64url JSON, the names may carry accents), the other
 * each product's category in a compact `key~category` list, so a large catalogue still fits.
 *
 * Pure (no `cookies()`, no `document`): the server reads through `store-setup-cookie.ts`, the
 * client writes through `store-setup-client.ts`, and both parse with the functions here, which drop
 * anything malformed rather than throw (a cookie is user input).
 */

export const STORE_SETUP_COOKIE = 'rede_store_setup';
export const STORE_ASSIGN_COOKIE = 'rede_store_cats';

/** The glyphs a category may take (lucide names, drawn by `StoreCategoryGlyph`). */
export const STORE_CATEGORY_ICONS = [
  'graduation-cap',
  'book-open',
  'file-text',
  'shirt',
  'spray-can',
  'wrench',
  'calendar-check',
  'package',
  'tag',
  'sparkles',
  'gift',
  'heart',
  'star',
  'gem',
  'coffee',
  'dumbbell',
  'palette',
  'camera',
  'laptop',
  'music',
] as const;
export type StoreCategoryIcon = (typeof STORE_CATEGORY_ICONS)[number];

/** The most categories a store keeps, a name's longest, and the most featured products. */
export const STORE_CATEGORY_MAX = 20;
export const STORE_CATEGORY_NAME_MAX = 30;
export const STORE_FEATURED_MAX = 5;

/** A category as Gerenciar keeps it: a stable id (the `?categoria=` slug), its name and glyph. */
export interface StoreCategoryDef {
  id: string;
  name: string;
  icon: StoreCategoryIcon;
}

export interface StoreSetup {
  /** The categories in the storefront's order; `null` = the store's built-in eight, untouched. */
  categories: StoreCategoryDef[] | null;
  /** "Em destaque", first to last (the first is the large card); `[]` = the newest products. */
  featured: string[];
}

/** Each product's category: `productKey(id)` to the category's id, or `NO_CATEGORY`. */
export type StoreAssignments = ReadonlyMap<string, string>;

/** A product the manager put in no category: its name's guess no longer applies. */
export const NO_CATEGORY = '_';

export const EMPTY_STORE_SETUP: StoreSetup = { categories: null, featured: [] };

/** The built-in categories' glyphs (the storefront's tiles before 2026-10-28). */
export const BUILT_IN_ICON: Record<StoreCategory, StoreCategoryIcon> = {
  cursos: 'graduation-cap',
  livros: 'book-open',
  materiais: 'file-text',
  roupas: 'shirt',
  perfumes: 'spray-can',
  equipamentos: 'wrench',
  servicos: 'calendar-check',
  outros: 'package',
};

const ID = /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[0-9a-f]{12}$/;

function isIcon(value: unknown): value is StoreCategoryIcon {
  return typeof value === 'string' && (STORE_CATEGORY_ICONS as readonly string[]).includes(value);
}

function isBuiltIn(id: string): id is StoreCategory {
  return (STORE_CATEGORIES as readonly string[]).includes(id);
}

/**
 * A product's key in the assignments: the LAST 12 hex digits of its id, random in every UUID
 * version (the first ones are a timestamp in a v7), so unique enough per store and short enough
 * for a large catalogue to fit in one cookie.
 */
export function productKey(productId: string): string {
  return productId.replace(/-/g, '').slice(-12).toLowerCase();
}

/** A name as kept: trimmed, inner runs of space folded, at most `STORE_CATEGORY_NAME_MAX`. */
export function cleanCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, STORE_CATEGORY_NAME_MAX).trim();
}

/** "Skin care & Cia" → "skin-care-cia", unique among `taken` ("-2", "-3"…). */
export function newCategoryId(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20)
      .replace(/-+$/, '') || 'categoria';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/* ── The cookies' text ────────────────────────────────────────────────────────────────────── */

function toBase64Url(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(raw: string): string | null {
  try {
    const binary = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The setup cookie's value. */
export function encodeStoreSetup(setup: StoreSetup): string {
  return toBase64Url(
    JSON.stringify({
      v: 1,
      c: setup.categories?.map((category) => [category.id, category.name, category.icon]) ?? null,
      f: setup.featured,
    }),
  );
}

/** The setup cookie read back; anything malformed is dropped (a bad cookie is the default). */
export function parseStoreSetup(raw: string | undefined | null): StoreSetup {
  if (!raw) return EMPTY_STORE_SETUP;
  const text = fromBase64Url(raw);
  if (text === null) return EMPTY_STORE_SETUP;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return EMPTY_STORE_SETUP;
  }
  if (typeof data !== 'object' || data === null) return EMPTY_STORE_SETUP;
  const { c, f } = data as { c?: unknown; f?: unknown };

  let categories: StoreCategoryDef[] | null = null;
  if (Array.isArray(c)) {
    const seen = new Set<string>();
    categories = [];
    for (const entry of c.slice(0, STORE_CATEGORY_MAX)) {
      if (!Array.isArray(entry)) continue;
      const [id, name, icon] = entry as unknown[];
      if (typeof id !== 'string' || !ID.test(id) || seen.has(id)) continue;
      if (typeof name !== 'string') continue;
      const clean = cleanCategoryName(name);
      if (clean === '') continue;
      seen.add(id);
      categories.push({ id, name: clean, icon: isIcon(icon) ? icon : 'tag' });
    }
  }

  const featured: string[] = [];
  if (Array.isArray(f)) {
    for (const id of f) {
      if (featured.length === STORE_FEATURED_MAX) break;
      if (typeof id === 'string' && UUID.test(id) && !featured.includes(id.toLowerCase())) {
        featured.push(id.toLowerCase());
      }
    }
  }
  return { categories, featured };
}

/** The assignments cookie's value: `key~category` pairs joined by dots. */
export function encodeAssignments(assignments: StoreAssignments): string {
  return [...assignments].map(([key, category]) => `${key}~${category}`).join('.');
}

/** The assignments read back; a malformed pair is dropped. */
export function parseAssignments(raw: string | undefined | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const pair of raw.split('.')) {
    const [key, category] = pair.split('~');
    if (key && category && KEY.test(key) && (category === NO_CATEGORY || ID.test(category))) {
      map.set(key, category);
    }
  }
  return map;
}

/* ── What the screens read ────────────────────────────────────────────────────────────────── */

type Translate = (key: string) => string;

/** A category as the screens show it: its name (the tile, the shelf), its chip and its glyph. */
export interface StoreCategoryView {
  id: string;
  name: string;
  /** The card's chip: a built-in category's singular ("Livro"), else its own name. */
  tag: string;
  icon: StoreCategoryIcon;
}

/** The built-in eight, named by the catalog (`t` reads the full key, `store.categories.…`). */
export function builtInCategories(t: Translate): StoreCategoryDef[] {
  return STORE_CATEGORIES.map((id) => ({
    id,
    name: t(`store.categories.names.${id}`),
    icon: BUILT_IN_ICON[id],
  }));
}

/** The store's category ids, in its order (the `?categoria=` the storefront accepts). */
export function storeCategoryIds(setup: StoreSetup): string[] {
  return setup.categories?.map((category) => category.id) ?? [...STORE_CATEGORIES];
}

/** The store's categories, in its order, as the screens show them. */
export function storeCategoryList(setup: StoreSetup, t: Translate): StoreCategoryView[] {
  const defs = setup.categories ?? builtInCategories(t);
  return defs.map((def) => ({
    ...def,
    tag:
      isBuiltIn(def.id) && def.name === t(`store.categories.names.${def.id}`)
        ? t(`store.categories.tags.${def.id}`)
        : def.name,
  }));
}

/**
 * A product's category id, or `null` when it has none the store keeps: the one chosen in the
 * product's form, else the API's (once it sends one), else the one its name tells, each only while
 * that category exists.
 */
export function categoryOf(
  product: { id: string; name: string; category?: string | undefined },
  categories: readonly { id: string }[],
  assignments: StoreAssignments,
): string | null {
  const known = (id: string | undefined) =>
    id !== undefined && categories.some((category) => category.id === id);
  const chosen = assignments.get(productKey(product.id));
  if (chosen === NO_CATEGORY) return null;
  if (known(chosen)) return chosen ?? null;
  if (known(product.category)) return product.category ?? null;
  const guess = guessStoreCategory(product.name);
  return known(guess) ? guess : null;
}
