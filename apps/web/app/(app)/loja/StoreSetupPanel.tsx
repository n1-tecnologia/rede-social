'use client';

import {
  STORE_CATEGORY_ICONS,
  STORE_CATEGORY_MAX,
  STORE_CATEGORY_NAME_MAX,
  STORE_FEATURED_MAX,
} from '@rede-social/module-store/contracts';
import { BottomSheet, Button, cn, IconButton, useMediaQuery, useToast } from '@rede-social/ui';
import { ArrowDown, ArrowUp, Check, LayoutGrid, Plus, Star, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import {
  builtInCategories,
  cleanCategoryName,
  type StoreCategoryDef,
  type StoreCategoryIcon,
} from '@/lib/store-categories';
import {
  type StoreSetupSaveResult,
  saveStoreCategoriesAction,
  setStoreFeaturedAction,
} from './actions';
import { STORE_CATEGORY_GLYPH } from './category-glyphs';

/** A product the featured picker lists: its name, its price and the server's 40×50 thumb. */
export interface StoreSetupProduct {
  id: string;
  name: string;
  price: string;
  thumb: ReactNode;
}

export interface StoreSetupPanelProps {
  /** The store's active products, newest first. */
  products: readonly StoreSetupProduct[];
  /** The store's own categories, in its order (`GET /v1/store/front`). */
  categories: readonly StoreCategoryDef[];
  /** How many active products each category holds. */
  counts: Readonly<Record<string, number>>;
  /** The store's featured products, still on sale, first to last. */
  featured: readonly string[];
}

const CARD = 'flex min-w-0 flex-col gap-4 rounded-3xl border border-border bg-card p-5';
const DISC =
  'flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand';
const EDIT =
  'inline-flex h-9 shrink-0 items-center justify-center rounded-full border border-border-secondary px-4 text-xs font-bold text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';
const FIELD =
  'h-11 min-w-0 flex-1 rounded-xl border border-border bg-bg-input px-3 text-sm font-semibold text-text placeholder:font-normal placeholder:text-text-tertiary focus:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30';
const THUMB = 'relative h-[50px] w-10 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary';

/** A sheet closed by nothing: what a save in flight leaves the backdrop, Escape and the drag. */
const NO_CLOSE = () => {};

/**
 * The one error line of a sheet (UI-D-686): 14/400 `text-danger`, `role="alert"`, directly above the
 * Save button. A refusal of the API takes focus when it appears (`focusIt`), so it is read where the
 * admin is looking; the draft's own validation line never does, it would pull focus out of the field
 * being typed in.
 */
function SaveError({ message, focusIt }: { message: string | null; focusIt: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message && focusIt) ref.current?.focus();
  }, [message, focusIt]);
  if (!message) return null;
  return (
    <p
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="text-sm font-normal text-danger focus:outline-none"
    >
      {message}
    </p>
  );
}

/**
 * Gerenciar's store setup (the product owner, 2026-10-28: "na tela de gerenciar da parte de loja
 * quero que tenha como gerenciar as categorias e o destaque"): two cards over the products, each
 * opening its sheet.
 *
 *  - "Em destaque": the products the storefront's hero shows, picked in order (the first is the
 *    large card), up to five; none picked = the newest, as before.
 *  - "Categorias": the store's categories, created, renamed, given a glyph, ordered (the shelves'
 *    order) and removed; the product form's "Categoria" menu lists them.
 *
 * Since 12.3-13 (D-690, D-691, D-699) both are kept by the API for every member (`PUT
 * /v1/store/front/featured` and `PUT /v1/store/categories`), and each card says who sees it. Each
 * sheet keeps a DRAFT until Save (UI-D-686): Save is pending and the sheet cannot be closed while the
 * call is in flight; success closes it, toasts and refreshes the route; a refusal keeps it open with
 * the draft and one alert line; a stale answer refreshes and re-seeds the draft.
 */
export function StoreSetupPanel({ products, categories, counts, featured }: StoreSetupPanelProps) {
  const t = useTranslations('store.setup');
  const tCount = useTranslations('store.categories');
  const router = useRouter();
  const toast = useToast();
  const desktop = useMediaQuery('(min-width: 768px)');
  const [sheet, setSheet] = useState<'featured' | 'categories' | null>(null);

  const byId = new Map(products.map((product) => [product.id, product]));
  const shown = featured.flatMap((id) => byId.get(id) ?? []);

  const saved = (message: string) => {
    setSheet(null);
    toast.show({ tone: 'success', message });
    router.refresh();
  };

  return (
    <section data-testid="store-setup" className="grid gap-4 px-4 pb-6 md:grid-cols-2">
      {/* ── "Em destaque" ── */}
      <div data-testid="store-setup-featured" className={CARD}>
        <div className="flex items-start gap-3">
          <span aria-hidden className={DISC}>
            <Star size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold leading-tight text-text">{t('featured.title')}</h2>
            <p className="mt-0.5 text-xs font-normal text-text-secondary">{t('featured.sub')}</p>
          </div>
          <button
            type="button"
            data-testid="store-setup-featured-edit"
            aria-haspopup="dialog"
            className={EDIT}
            onClick={() => setSheet('featured')}
          >
            {t('featured.edit')}
          </button>
        </div>
        {shown.length > 0 ? (
          <ol aria-label={t('featured.title')} className="flex flex-wrap gap-2.5">
            {shown.map((product, index) => (
              <li key={product.id} className="flex min-w-0 items-center gap-2">
                <span className={cn(THUMB, index === 0 && 'ring-2 ring-brand')}>
                  {product.thumb}
                  <span className="absolute top-1 left-1 flex size-4 items-center justify-center rounded-full bg-black/65 text-[10px] font-bold text-white">
                    {index + 1}
                  </span>
                </span>
                {index === 0 ? (
                  <span className="flex min-w-0 max-w-40 flex-col">
                    <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand">
                      {t('featured.main')}
                    </span>
                    <span className="truncate text-xs font-semibold text-text">{product.name}</span>
                  </span>
                ) : (
                  <span className="sr-only">{product.name}</span>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm font-normal text-text-secondary">{t('featured.auto')}</p>
        )}
        <p className="text-xs font-normal text-text-tertiary">{t('featured.scope')}</p>
      </div>

      {/* ── "Categorias" ── */}
      <div data-testid="store-setup-categories" className={CARD}>
        <div className="flex items-start gap-3">
          <span aria-hidden className={DISC}>
            <LayoutGrid size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold leading-tight text-text">
              {t('categories.title')}
            </h2>
            <p className="mt-0.5 text-xs font-normal text-text-secondary">
              {t('categories.sub', { n: categories.length })}
            </p>
          </div>
          <button
            type="button"
            data-testid="store-setup-categories-edit"
            aria-haspopup="dialog"
            className={EDIT}
            onClick={() => setSheet('categories')}
          >
            {t('categories.manage')}
          </button>
        </div>
        <ul aria-label={t('categories.title')} className="flex flex-wrap gap-2">
          {categories.map((category) => {
            const Icon = STORE_CATEGORY_GLYPH[category.icon];
            return (
              <li
                key={category.id}
                className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-bg-secondary px-3 py-1.5 text-xs font-semibold text-text"
              >
                <Icon aria-hidden size={14} className="shrink-0 text-brand" />
                <span className="truncate">{category.name}</span>
                <span className="shrink-0 font-normal text-text-tertiary">
                  {tCount('count', { n: counts[category.id] ?? 0 })}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-xs font-normal text-text-tertiary">{t('categories.scope')}</p>
      </div>

      {/* Inside the page, never portaled: the sheets take the tenant's brand from the shell. */}
      <FeaturedSheet
        // A fresh draft on every opening: Cancelar never leaves edits behind.
        key={sheet === 'featured' ? 'open' : 'closed'}
        open={sheet === 'featured'}
        desktop={desktop}
        products={products}
        featured={featured}
        onClose={() => setSheet(null)}
        onSaved={() => saved(t('featured.saved'))}
      />
      <CategoriesSheet
        key={sheet === 'categories' ? 'open' : 'closed'}
        open={sheet === 'categories'}
        desktop={desktop}
        categories={categories}
        counts={counts}
        onClose={() => setSheet(null)}
        onSaved={() => saved(t('categories.saved'))}
      />
    </section>
  );
}

/** The featured picker: tap the products in order, up to five; the first is the large card. */
function FeaturedSheet({
  open,
  desktop,
  products,
  featured,
  onClose,
  onSaved,
}: {
  open: boolean;
  desktop: boolean;
  products: readonly StoreSetupProduct[];
  featured: readonly string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('store.setup');
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>(() => [...featured]);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // A stale answer asked for a refresh: the draft re-seeds when the refreshed list arrives.
  const awaitingRefresh = useRef(false);
  useEffect(() => {
    if (awaitingRefresh.current) {
      awaitingRefresh.current = false;
      setPicked([...featured]);
    }
  }, [featured]);

  const toggle = (id: string) => {
    setFailure(null);
    setPicked((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length < STORE_FEATURED_MAX
          ? [...current, id]
          : current,
    );
  };

  const save = async () => {
    setPending(true);
    setFailure(null);
    let result: StoreSetupSaveResult;
    try {
      result = await setStoreFeaturedAction(picked);
    } catch {
      result = { ok: false, code: 'generic' };
    }
    setPending(false);
    if (result.ok) {
      onSaved();
      return;
    }
    if (result.code === 'featured_invalid' || result.code === 'too_many_featured') {
      setFailure(t(`featured.errors.${result.code}`, { max: STORE_FEATURED_MAX }));
    } else {
      setFailure(t('featured.errors.generic'));
    }
    if (result.code === 'featured_invalid') {
      awaitingRefresh.current = true;
      router.refresh();
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={pending ? NO_CLOSE : onClose}
      title={t('featured.sheetTitle')}
      desktopCard={desktop}
      initialFocus="title"
      scroll="content"
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-1 pb-3">
        <p className="text-sm font-normal text-text-secondary">
          {t('featured.helper', { max: STORE_FEATURED_MAX })}
        </p>
        {products.length === 0 ? (
          <p className="pt-4 text-sm font-normal text-text-tertiary">{t('featured.empty')}</p>
        ) : (
          <ul data-testid="store-setup-featured-options" className="-mx-2 mt-3 flex flex-col">
            {products.map((product) => {
              const position = picked.indexOf(product.id);
              const on = position >= 0;
              const full = !on && picked.length >= STORE_FEATURED_MAX;
              return (
                <li key={product.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={full || pending}
                    data-featured-option={product.id}
                    onClick={() => toggle(product.id)}
                    className={cn(
                      'flex min-h-16 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand disabled:opacity-45',
                      on && 'bg-brand/[0.06]',
                    )}
                  >
                    <span aria-hidden className={THUMB}>
                      {product.thumb}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-bold text-text">{product.name}</span>
                      <span className="truncate text-xs font-normal text-text-secondary tabular-nums">
                        {on && position === 0
                          ? t('featured.mainLine', { price: product.price })
                          : product.price}
                      </span>
                    </span>
                    <span
                      aria-hidden={!on}
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                        on
                          ? 'bg-brand text-on-brand'
                          : 'border border-border-secondary text-transparent',
                      )}
                    >
                      {on ? (
                        <>
                          <span aria-hidden>{position + 1}</span>
                          <span className="sr-only">
                            {t('featured.position', { n: position + 1 })}
                          </span>
                        </>
                      ) : (
                        <Check aria-hidden size={14} />
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
        <SaveError message={failure} focusIt />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto px-2"
            disabled={picked.length === 0 || pending}
            onClick={() => {
              setFailure(null);
              setPicked([]);
            }}
          >
            {t('featured.useNewest')}
          </Button>
          <Button variant="outline" size="sm" disabled={pending} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="brand"
            size="sm"
            loading={pending}
            data-testid="store-setup-featured-save"
            onClick={save}
          >
            {pending ? t('saving') : t('save')}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}

/**
 * A row of the categories' draft. A row the store already holds keeps its slug (`id`, the row's
 * identity: a rename never changes it); a row added in the draft has none and the server mints it.
 * `key` is the React key: the slug, or a local one for a new row.
 */
interface DraftRow {
  key: string;
  id: string | null;
  name: string;
  icon: StoreCategoryIcon;
}

function seedRows(categories: readonly StoreCategoryDef[]): DraftRow[] {
  return categories.map(({ id, name, icon }) => ({ key: id, id, name, icon }));
}

/** The refusal codes of the categories' save that have a sentence of their own. */
const CATEGORY_SENTENCE: Record<string, string> = {
  category_name_required: 'empty',
  category_name_taken: 'taken',
  too_many_categories: 'max',
  category_name_too_long: 'category_name_too_long',
  category_icon_invalid: 'category_icon_invalid',
  category_invalid: 'category_invalid',
};

/** The categories' editor: rename, glyph, order, remove and add; saved as a whole. */
function CategoriesSheet({
  open,
  desktop,
  categories,
  counts,
  onClose,
  onSaved,
}: {
  open: boolean;
  desktop: boolean;
  categories: readonly StoreCategoryDef[];
  counts: Readonly<Record<string, number>>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('store.setup');
  const tCount = useTranslations('store.categories');
  const router = useRouter();
  const [draft, setDraft] = useState<DraftRow[]>(() => seedRows(categories));
  const [iconFor, setIconFor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const newId = useId();
  const added = useRef(0);
  // A stale answer asked for a refresh: the draft re-seeds when the refreshed list arrives.
  const awaitingRefresh = useRef(false);
  useEffect(() => {
    if (awaitingRefresh.current) {
      awaitingRefresh.current = false;
      setDraft(seedRows(categories));
      setIconFor(null);
      setRemoving(null);
    }
  }, [categories]);

  /** Every edit of the draft clears the last refusal: it described the draft as it was. */
  const edit = (change: (rows: DraftRow[]) => DraftRow[]) => {
    setFailure(null);
    setDraft(change);
  };

  const names = draft.map((row) => cleanCategoryName(row.name).toLocaleLowerCase('pt-BR'));
  const emptyName = names.some((name) => name === '');
  const duplicate = names.some((name, index) => name !== '' && names.indexOf(name) !== index);
  const error = emptyName
    ? t('categories.errors.empty')
    : duplicate
      ? t('categories.errors.taken')
      : null;

  const update = (key: string, patch: Partial<DraftRow>) =>
    edit((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const move = (key: string, delta: -1 | 1) => {
    const from = draft.findIndex((row) => row.key === key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= draft.length) return;
    const next = [...draft];
    const [row] = next.splice(from, 1);
    if (!row) return;
    next.splice(to, 0, row);
    edit(() => next);
    setAnnouncement(
      t('categories.moved', { name: row.name, position: to + 1, total: next.length }),
    );
  };

  const add = () => {
    const name = cleanCategoryName(newName);
    if (name === '') {
      setAddError(t('categories.errors.empty'));
      return;
    }
    if (draft.length >= STORE_CATEGORY_MAX) {
      setAddError(t('categories.errors.max', { max: STORE_CATEGORY_MAX }));
      return;
    }
    if (names.includes(name.toLocaleLowerCase('pt-BR'))) {
      setAddError(t('categories.errors.taken'));
      return;
    }
    added.current += 1;
    edit((rows) => [...rows, { key: `new-${added.current}`, id: null, name, icon: 'tag' }]);
    setNewName('');
    setAddError(null);
  };

  /**
   * "Restaurar as categorias padrão": the eight built-ins replace the DRAFT only; Save commits them.
   * A built-in slug the store still holds keeps it as its id; one the store no longer holds goes as a
   * new row (the server refuses an unknown id), and mints the same slug from the same name.
   */
  const reset = () => {
    const held = new Set(categories.map((category) => category.id));
    added.current += 1;
    const round = added.current;
    edit(() =>
      builtInCategories().map(({ id, name, icon }) => ({
        key: held.has(id) ? id : `new-${round}-${id}`,
        id: held.has(id) ? id : null,
        name,
        icon,
      })),
    );
    setIconFor(null);
    setRemoving(null);
  };

  const save = async () => {
    if (error) return;
    setPending(true);
    setFailure(null);
    let result: StoreSetupSaveResult;
    try {
      result = await saveStoreCategoriesAction(
        draft.map((row) => ({
          ...(row.id === null ? {} : { id: row.id }),
          name: cleanCategoryName(row.name),
          icon: row.icon,
        })),
      );
    } catch {
      result = { ok: false, code: 'generic' };
    }
    setPending(false);
    if (result.ok) {
      onSaved();
      return;
    }
    setFailure(
      t(`categories.errors.${CATEGORY_SENTENCE[result.code] ?? 'generic'}`, {
        max: result.code === 'too_many_categories' ? STORE_CATEGORY_MAX : STORE_CATEGORY_NAME_MAX,
      }),
    );
    if (result.code === 'category_invalid') {
      awaitingRefresh.current = true;
      router.refresh();
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={pending ? NO_CLOSE : onClose}
      title={t('categories.sheetTitle')}
      desktopCard={desktop}
      initialFocus="title"
      scroll="content"
      dismiss="handle"
      handleLabel={t('cancel')}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-1 pb-3">
        <p className="text-sm font-normal text-text-secondary">{t('categories.helper')}</p>

        <ol data-testid="store-setup-categories-list" className="mt-3 flex flex-col gap-2">
          {draft.map((row, index) => {
            const Icon = STORE_CATEGORY_GLYPH[row.icon];
            const count = row.id === null ? 0 : (counts[row.id] ?? 0);
            return (
              <li
                key={row.key}
                data-category-row={row.id ?? row.key}
                className="flex flex-col gap-2 rounded-2xl border border-border bg-bg-secondary/50 p-2"
              >
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={t('categories.icon', { name: row.name })}
                    aria-expanded={iconFor === row.key}
                    disabled={pending}
                    onClick={() => setIconFor(iconFor === row.key ? null : row.key)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand transition-colors hover:bg-brand/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <Icon aria-hidden size={18} />
                  </button>
                  <input
                    value={row.name}
                    maxLength={STORE_CATEGORY_NAME_MAX}
                    disabled={pending}
                    aria-label={t('categories.nameLabel', { n: index + 1 })}
                    aria-describedby={`${row.key}-count`}
                    onChange={(event) => update(row.key, { name: event.target.value })}
                    className={FIELD}
                  />
                  <span id={`${row.key}-count`} className="sr-only">
                    {tCount('count', { n: count })}
                  </span>
                  <IconButton
                    icon={ArrowUp}
                    label={t('categories.moveUp', { name: row.name })}
                    size={18}
                    disabled={index === 0 || pending}
                    onClick={() => move(row.key, -1)}
                    className="shrink-0"
                  />
                  <IconButton
                    icon={ArrowDown}
                    label={t('categories.moveDown', { name: row.name })}
                    size={18}
                    disabled={index === draft.length - 1 || pending}
                    onClick={() => move(row.key, 1)}
                    className="shrink-0"
                  />
                  <IconButton
                    icon={Trash2}
                    label={t('categories.remove', { name: row.name })}
                    size={18}
                    disabled={pending}
                    onClick={() => setRemoving(row.key)}
                    className="shrink-0 text-danger"
                  />
                </div>
                <p className="px-1 text-[11px] font-normal text-text-tertiary">
                  {tCount('count', { n: count })}
                </p>

                {iconFor === row.key ? (
                  <div
                    role="radiogroup"
                    aria-label={t('categories.iconPick')}
                    className="grid grid-cols-5 gap-1.5 px-1 min-[400px]:grid-cols-10"
                  >
                    {STORE_CATEGORY_ICONS.map((icon) => {
                      const Glyph = STORE_CATEGORY_GLYPH[icon];
                      const checked = icon === row.icon;
                      return (
                        // biome-ignore lint/a11y/useSemanticElements: a glyph grid; a native radio cannot draw the icon as its whole face
                        <button
                          key={icon}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          aria-label={t(`icons.${icon}`)}
                          onClick={() => {
                            update(row.key, { icon });
                            setIconFor(null);
                          }}
                          className={cn(
                            'flex aspect-square items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                            checked
                              ? 'bg-brand text-on-brand'
                              : 'bg-card text-text-secondary hover:bg-bg-hover',
                          )}
                        >
                          <Glyph aria-hidden size={17} />
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {removing === row.key ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl bg-danger/10 px-3 py-2">
                    <p className="min-w-0 flex-1 text-xs font-normal text-text">
                      {t('categories.removeConfirm', { name: row.name })}
                    </p>
                    <Button variant="outline" size="sm" onClick={() => setRemoving(null)}>
                      {t('cancel')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        edit((rows) => rows.filter((entry) => entry.key !== row.key));
                        setRemoving(null);
                      }}
                    >
                      {t('categories.removeYes')}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className="mt-4 flex flex-col gap-1.5">
          <label htmlFor={newId} className="text-sm font-normal text-text-secondary">
            {t('categories.newLabel')}
          </label>
          <div className="flex items-center gap-2">
            <input
              id={newId}
              value={newName}
              maxLength={STORE_CATEGORY_NAME_MAX}
              disabled={pending}
              placeholder={t('categories.newPlaceholder')}
              onChange={(event) => {
                setNewName(event.target.value);
                setAddError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  add();
                }
              }}
              className={FIELD}
            />
            <Button
              variant="outline"
              size="md"
              disabled={pending}
              data-testid="store-setup-category-add"
              onClick={add}
              className="shrink-0 rounded-xl"
            >
              <Plus aria-hidden size={16} />
              {t('categories.add')}
            </Button>
          </div>
          {addError ? (
            <p role="alert" className="text-xs font-normal text-danger">
              {addError}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          disabled={pending}
          onClick={reset}
          className="mt-4 text-xs font-semibold text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {t('categories.reset')}
        </button>
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
      <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
        <SaveError message={failure ?? error} focusIt={failure !== null} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={pending} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="brand"
            size="sm"
            loading={pending}
            disabled={error !== null}
            data-testid="store-setup-categories-save"
            onClick={save}
          >
            {pending ? t('saving') : t('save')}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
