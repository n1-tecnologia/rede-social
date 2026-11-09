'use client';

import { BottomSheet, Button, cn, IconButton, useMediaQuery, useToast } from '@rede-social/ui';
import { ArrowDown, ArrowUp, Check, LayoutGrid, Plus, Star, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useId, useState } from 'react';
import {
  cleanCategoryName,
  newCategoryId,
  STORE_CATEGORY_ICONS,
  STORE_CATEGORY_MAX,
  STORE_CATEGORY_NAME_MAX,
  STORE_FEATURED_MAX,
  type StoreCategoryDef,
  type StoreCategoryIcon,
} from '@/lib/store-setup';
import { forgetCategory, saveStoreSetup } from '@/lib/store-setup-client';
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
  /** The categories as the store shows them now (its own, or the built-in eight named). */
  categories: readonly StoreCategoryDef[];
  /** The built-in eight, named: what "Restaurar as categorias padrão" returns to. */
  builtIn: readonly StoreCategoryDef[];
  /** True when this device keeps its own categories (else the built-in eight are in use). */
  custom: boolean;
  /** How many active products each category holds. */
  counts: Readonly<Record<string, number>>;
  /** The featured products this device keeps, still on sale, first to last. */
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

/** Two lists of categories hold the same names, glyphs and order. */
function sameCategories(a: readonly StoreCategoryDef[], b: readonly StoreCategoryDef[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (category, index) =>
        category.id === b[index]?.id &&
        category.name === b[index]?.name &&
        category.icon === b[index]?.icon,
    )
  );
}

/**
 * 2026-10-28 — Gerenciar's store setup (the product owner: "na tela de gerenciar da parte de loja
 * quero que tenha como gerenciar as categorias e o destaque"): two cards over the products, each
 * opening its sheet.
 *
 *  - "Em destaque": the products the storefront's hero shows, picked in order (the first is the
 *    large card), up to five; none picked = the newest, as before.
 *  - "Categorias": the store's categories, created, renamed, given a glyph, ordered (the shelves'
 *    order) and removed; the product form's "Categoria" menu lists them.
 *
 * ⚠ Front only: both are kept on THIS device (`lib/store-setup.ts`) until the API keeps them, and
 * each card says so. A save refreshes the route, so the storefront and the counts follow at once.
 */
export function StoreSetupPanel({
  products,
  categories,
  builtIn,
  custom,
  counts,
  featured,
}: StoreSetupPanelProps) {
  const t = useTranslations('store.setup');
  const tCount = useTranslations('store.categories');
  const router = useRouter();
  const toast = useToast();
  const desktop = useMediaQuery('(min-width: 768px)');
  const [sheet, setSheet] = useState<'featured' | 'categories' | null>(null);

  const byId = new Map(products.map((product) => [product.id, product]));
  const shown = featured.flatMap((id) => byId.get(id) ?? []);

  const keepFeatured = (next: readonly string[]) => {
    saveStoreSetup({ categories: custom ? [...categories] : null, featured: [...next] });
    setSheet(null);
    toast.show({ tone: 'success', message: t('featured.saved') });
    router.refresh();
  };

  const keepCategories = (next: readonly StoreCategoryDef[]) => {
    const removed = categories.filter(
      (category) => !next.some((entry) => entry.id === category.id),
    );
    for (const category of removed) forgetCategory(category.id);
    saveStoreSetup({
      categories: sameCategories(next, builtIn) ? null : [...next],
      featured: [...featured],
    });
    setSheet(null);
    toast.show({ tone: 'success', message: t('categories.saved') });
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
        <p className="text-[11px] font-normal text-text-tertiary">{t('device')}</p>
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
                <span className="font-normal text-text-tertiary">
                  {tCount('count', { n: counts[category.id] ?? 0 })}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-[11px] font-normal text-text-tertiary">{t('device')}</p>
      </div>

      {/* Inside the page, never portaled: the sheets take the tenant's brand from the shell. */}
      <FeaturedSheet
        open={sheet === 'featured'}
        desktop={desktop}
        products={products}
        featured={featured}
        onClose={() => setSheet(null)}
        onSave={keepFeatured}
      />
      <CategoriesSheet
        // A fresh draft on every opening: Cancelar never leaves edits behind.
        key={sheet === 'categories' ? 'open' : 'closed'}
        open={sheet === 'categories'}
        desktop={desktop}
        categories={categories}
        builtIn={builtIn}
        counts={counts}
        onClose={() => setSheet(null)}
        onSave={keepCategories}
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
  onSave,
}: {
  open: boolean;
  desktop: boolean;
  products: readonly StoreSetupProduct[];
  featured: readonly string[];
  onClose: () => void;
  onSave: (next: readonly string[]) => void;
}) {
  const t = useTranslations('store.setup');
  const [picked, setPicked] = useState<string[]>([...featured]);
  // Every opening starts from what is saved.
  useEffect(() => {
    if (open) setPicked([...featured]);
  }, [open, featured]);

  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length < STORE_FEATURED_MAX
          ? [...current, id]
          : current,
    );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
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
                    disabled={full}
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
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="mr-auto px-2"
          disabled={picked.length === 0}
          onClick={() => setPicked([])}
        >
          {t('featured.useNewest')}
        </Button>
        <Button variant="outline" size="sm" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button
          variant="brand"
          size="sm"
          data-testid="store-setup-featured-save"
          onClick={() => onSave(picked)}
        >
          {t('save')}
        </Button>
      </div>
    </BottomSheet>
  );
}

/** The categories' editor: rename, glyph, order, remove and add; saved as a whole. */
function CategoriesSheet({
  open,
  desktop,
  categories,
  builtIn,
  counts,
  onClose,
  onSave,
}: {
  open: boolean;
  desktop: boolean;
  categories: readonly StoreCategoryDef[];
  builtIn: readonly StoreCategoryDef[];
  counts: Readonly<Record<string, number>>;
  onClose: () => void;
  onSave: (next: readonly StoreCategoryDef[]) => void;
}) {
  const t = useTranslations('store.setup');
  const tCount = useTranslations('store.categories');
  const [draft, setDraft] = useState<StoreCategoryDef[]>(() => [...categories]);
  const [iconFor, setIconFor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const newId = useId();

  const names = draft.map((category) =>
    cleanCategoryName(category.name).toLocaleLowerCase('pt-BR'),
  );
  const emptyName = names.some((name) => name === '');
  const duplicate = names.some((name, index) => name !== '' && names.indexOf(name) !== index);
  const error = emptyName
    ? t('categories.errors.empty')
    : duplicate
      ? t('categories.errors.taken')
      : null;

  const update = (id: string, patch: Partial<StoreCategoryDef>) =>
    setDraft((current) =>
      current.map((category) => (category.id === id ? { ...category, ...patch } : category)),
    );

  const move = (id: string, delta: -1 | 1) => {
    const from = draft.findIndex((category) => category.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= draft.length) return;
    const next = [...draft];
    const [row] = next.splice(from, 1);
    if (!row) return;
    next.splice(to, 0, row);
    setDraft(next);
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
    const id = newCategoryId(name, new Set(draft.map((category) => category.id)));
    setDraft((current) => [...current, { id, name, icon: 'tag' }]);
    setNewName('');
    setAddError(null);
  };

  const save = () => {
    if (error) return;
    onSave(draft.map((category) => ({ ...category, name: cleanCategoryName(category.name) })));
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
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
          {draft.map((category, index) => {
            const Icon = STORE_CATEGORY_GLYPH[category.icon];
            const count = counts[category.id] ?? 0;
            return (
              <li
                key={category.id}
                data-category-row={category.id}
                className="flex flex-col gap-2 rounded-2xl border border-border bg-bg-secondary/50 p-2"
              >
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={t('categories.icon', { name: category.name })}
                    aria-expanded={iconFor === category.id}
                    onClick={() => setIconFor(iconFor === category.id ? null : category.id)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand transition-colors hover:bg-brand/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <Icon aria-hidden size={18} />
                  </button>
                  <input
                    value={category.name}
                    maxLength={STORE_CATEGORY_NAME_MAX}
                    aria-label={t('categories.nameLabel', { n: index + 1 })}
                    aria-describedby={`${category.id}-count`}
                    onChange={(event) => update(category.id, { name: event.target.value })}
                    className={FIELD}
                  />
                  <span id={`${category.id}-count`} className="sr-only">
                    {tCount('count', { n: count })}
                  </span>
                  <IconButton
                    icon={ArrowUp}
                    label={t('categories.moveUp', { name: category.name })}
                    size={18}
                    disabled={index === 0}
                    onClick={() => move(category.id, -1)}
                    className="shrink-0"
                  />
                  <IconButton
                    icon={ArrowDown}
                    label={t('categories.moveDown', { name: category.name })}
                    size={18}
                    disabled={index === draft.length - 1}
                    onClick={() => move(category.id, 1)}
                    className="shrink-0"
                  />
                  <IconButton
                    icon={Trash2}
                    label={t('categories.remove', { name: category.name })}
                    size={18}
                    onClick={() => setRemoving(category.id)}
                    className="shrink-0 text-danger"
                  />
                </div>
                <p className="px-1 text-[11px] font-normal text-text-tertiary">
                  {tCount('count', { n: count })}
                </p>

                {iconFor === category.id ? (
                  <div
                    role="radiogroup"
                    aria-label={t('categories.iconPick')}
                    className="grid grid-cols-5 gap-1.5 px-1 min-[400px]:grid-cols-10"
                  >
                    {STORE_CATEGORY_ICONS.map((icon: StoreCategoryIcon) => {
                      const Glyph = STORE_CATEGORY_GLYPH[icon];
                      const checked = icon === category.icon;
                      return (
                        // biome-ignore lint/a11y/useSemanticElements: a glyph grid; a native radio cannot draw the icon as its whole face
                        <button
                          key={icon}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          aria-label={t(`icons.${icon}`)}
                          onClick={() => {
                            update(category.id, { icon });
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

                {removing === category.id ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl bg-danger/10 px-3 py-2">
                    <p className="min-w-0 flex-1 text-xs font-normal text-text">
                      {t('categories.removeConfirm', { name: category.name })}
                    </p>
                    <Button variant="outline" size="sm" onClick={() => setRemoving(null)}>
                      {t('cancel')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setDraft((current) => current.filter((entry) => entry.id !== category.id));
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
          onClick={() => setDraft([...builtIn])}
          className="mt-4 text-xs font-semibold text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {t('categories.reset')}
        </button>
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
        {error ? (
          <p role="alert" className="mr-auto text-xs font-normal text-danger">
            {error}
          </p>
        ) : null}
        <Button variant="outline" size="sm" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button
          variant="brand"
          size="sm"
          disabled={error !== null}
          data-testid="store-setup-categories-save"
          onClick={save}
        >
          {t('save')}
        </Button>
      </div>
    </BottomSheet>
  );
}
