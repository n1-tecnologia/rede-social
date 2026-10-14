'use client';

import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import type { Category } from '@rede-social/module-courses/contracts';
import { Button, EmptyState, PageHeader, useToast } from '@rede-social/ui';
import { ChevronRight, Plus, Tag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { CategorySheet } from './CategorySheet';

/**
 * The category manager island (08.3-07, D-411, UI-D-400, UI-D-407, COURSE-04): the `PageHeader`
 * (back "Voltar para Cursos", "Categorias", the trailing brand `sm` "Nova categoria"), the rows as
 * `<button>`s (a 3:4 thumb with the gradient fallback, the name 14/700, the ICU count 12/400, a
 * `ChevronRight`) in the API's order (`lower(name), id`), the `EmptyState` with "Criar categoria",
 * and ONE `CategorySheet` for creating and editing.
 *
 * The rows are the server's list; a write re-seeds them locally in the same `lower(name)` order the
 * API answers, and the action's `revalidatePath` keeps the next server render honest. Focus
 * (UI-D-407): the shipped trap returns focus to the opening row on close; after a REMOVAL the
 * opener is gone, so this island moves focus to the next row, or to "Nova categoria" when none is
 * left (E11 zero-one-many). The highlights manager shape: a small list and a small form in a sheet.
 */
export interface CategoryManagerProps {
  /** The tenant's categories as the server read them (the API's order). */
  initialItems: Category[];
}

type SheetState = { mode: 'new' } | { mode: 'edit'; category: Category };

const THUMB_SIZES = '40px';

const GRADIENT = (
  <span
    aria-hidden
    className="block h-full w-full"
    style={{ backgroundImage: 'var(--brand-gradient)' }}
  />
);

/** The API's order: `lower(name)`, then id — mirrored locally after a write. */
function byName(a: Category, b: Category): number {
  const names = a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
  return names !== 0 ? names : a.id.localeCompare(b.id);
}

export function CategoryManager({ initialItems }: CategoryManagerProps) {
  const t = useTranslations('courses');
  const toast = useToast();

  const [items, setItems] = useState(initialItems);
  // The SERVER sent a different list (a navigation or a revalidation): re-seed rather than merge.
  const [seed, setSeed] = useState(initialItems);
  if (seed !== initialItems) {
    setSeed(initialItems);
    setItems(initialItems);
  }

  /** Outlives the close (`open: false`) so the sheet's exit animation keeps its words. */
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [open, setOpen] = useState(false);
  /** Bumped on every open, so the sheet's form state starts fresh each time. */
  const [sheetKey, setSheetKey] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  /** After a removal: the row to focus next, or `null` for the create control. */
  const [pendingFocus, setPendingFocus] = useState<{ nextId: string | null } | null>(null);

  useEffect(() => {
    if (!pendingFocus) return;
    // Both traps must release first: the remove dialog's returns focus to its opener INSIDE the
    // closing sheet, then the sheet's finds its opener (the removed row) gone and leaves focus on
    // the body. So the move waits until no modal is left in the document (the exit springs are
    // ~300ms; the cap is ~2s), then lands on the next row or the create control.
    let frame = 0;
    let tries = 0;
    const tick = () => {
      if (document.querySelector('[aria-modal="true"]') !== null && tries < 120) {
        tries += 1;
        frame = requestAnimationFrame(tick);
        return;
      }
      const root = rootRef.current;
      const next =
        pendingFocus.nextId === null
          ? null
          : root?.querySelector<HTMLElement>(`[data-category-row="${pendingFocus.nextId}"]`);
      (next ?? root?.querySelector<HTMLElement>('[data-categories-create]'))?.focus({
        preventScroll: true,
      });
      setPendingFocus(null);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [pendingFocus]);

  const openSheet = (state: SheetState) => {
    setSheet(state);
    setSheetKey((key) => key + 1);
    setOpen(true);
  };
  const closeSheet = () => setOpen(false);

  const onCreated = (category: Category) => {
    setItems((current) => [...current, category].sort(byName));
    toast.show({ tone: 'success', message: t('toasts.categoryCreated') });
    closeSheet();
  };

  const onUpdated = (category: Category) => {
    setItems((current) =>
      current.map((item) => (item.id === category.id ? category : item)).sort(byName),
    );
    toast.show({ tone: 'success', message: t('toasts.saved') });
    closeSheet();
  };

  const onRemoved = (id: string) => {
    const index = items.findIndex((item) => item.id === id);
    const next = items[index + 1] ?? items[index - 1] ?? null;
    setItems((current) => current.filter((item) => item.id !== id));
    toast.show({ tone: 'success', message: t('toasts.categoryRemoved') });
    closeSheet();
    setPendingFocus({ nextId: next?.id ?? null });
  };

  return (
    <div
      ref={rootRef}
      data-testid="categories-manager"
      className="mx-auto flex w-full max-w-[680px] flex-col"
    >
      <PageHeader
        title={t('categories.title')}
        backHref="/cursos"
        backLabel={t('categories.back')}
        className="md:static md:px-0"
        trailing={
          <Button
            type="button"
            variant="brand"
            size="sm"
            data-categories-create
            className="h-11"
            onClick={() => openSheet({ mode: 'new' })}
          >
            <Plus aria-hidden size={16} className="shrink-0" />
            {t('categories.create')}
          </Button>
        }
      />

      {items.length === 0 ? (
        <div className="px-4 pt-2">
          <EmptyState
            variant="card"
            icon={Tag}
            data-testid="categories-empty"
            title={t('categories.empty.title')}
            body={t('categories.empty.body')}
            action={
              <Button
                type="button"
                variant="brand"
                size="md"
                data-categories-empty-create
                onClick={() => openSheet({ mode: 'new' })}
              >
                {t('categories.empty.cta')}
              </Button>
            }
          />
        </div>
      ) : (
        <ol
          aria-label={t('categories.title')}
          data-testid="categories-list"
          className="flex flex-col divide-y divide-divider pt-2"
        >
          {items.map((category) => (
            <li key={category.id}>
              <button
                type="button"
                data-category-row={category.id}
                aria-haspopup="dialog"
                onClick={() => openSheet({ mode: 'edit', category })}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-bg-hover active:bg-bg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
              >
                <span
                  data-testid={
                    category.coverAssetId ? 'category-row-thumb' : 'category-row-fallback'
                  }
                  className="relative block w-10 shrink-0 overflow-hidden rounded-lg bg-bg-tertiary aspect-[3/4]"
                  style={
                    category.coverAssetId ? undefined : { backgroundImage: 'var(--brand-gradient)' }
                  }
                >
                  {category.coverAssetId ? (
                    <span className="absolute inset-0 block">
                      <MediaImage
                        assetId={category.coverAssetId}
                        widths={PURPOSE_WIDTHS.cover}
                        alt={t('alt.category', { name: category.name })}
                        sizes={THUMB_SIZES}
                        ratio=""
                        className="h-full w-full"
                        fallback={GRADIENT}
                      />
                    </span>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    data-testid="category-row-name"
                    className="block truncate text-sm font-bold leading-tight text-text"
                  >
                    {category.name}
                  </span>
                  <span
                    data-testid="category-row-count"
                    className="mt-1 block text-xs font-normal text-text-secondary tabular-nums"
                  >
                    {t('category.count', { N: category.courseCount })}
                  </span>
                </span>
                <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
              </button>
            </li>
          ))}
        </ol>
      )}

      {sheet ? (
        <CategorySheet
          key={sheetKey}
          open={open}
          mode={sheet.mode}
          category={sheet.mode === 'edit' ? sheet.category : null}
          onClose={closeSheet}
          onCreated={onCreated}
          onUpdated={onUpdated}
          onRemoved={onRemoved}
        />
      ) : null}
    </div>
  );
}
