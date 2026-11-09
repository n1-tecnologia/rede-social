'use client';

import { iconFor, TenantLogo } from '@rede-social/core/ui';
import { Button, Card, cn, SectionTitle, useToast } from '@rede-social/ui';
import { Reorder, useReducedMotion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import {
  encodePhoneNavLayout,
  LEGACY_NAV_ORDER_COOKIE,
  PHONE_BAR_MAX,
  PHONE_BAR_MIN,
  PHONE_NAV_LAYOUT_COOKIE,
  PHONE_TOP_MAX,
  type PhonePlacement,
  placementAllowed,
} from '@/lib/phone-nav-layout';

/** One item of the phone's menu, as the shell draws it. */
export interface PhoneMenuItem {
  key: string;
  label: string;
  /** The nav entry's serialisable icon name (`iconFor`). */
  icon: string;
}

/** The bar's and the top's keys, in order. */
export interface PhoneMenuPlaces {
  bar: string[];
  top: string[];
}

export interface PhoneMenuEditorProps {
  /** Every item the administrator may place (the tabs, then the slots without a counter). */
  items: readonly PhoneMenuItem[];
  /** The counter slots (Notificações, Suporte): always at the top, drawn in the preview only. */
  fixed: readonly PhoneMenuItem[];
  /** The menu as this device draws it now. */
  initial: PhoneMenuPlaces;
  /** The shell's own menu: what "Restaurar o padrão" returns to. */
  defaults: PhoneMenuPlaces;
  /** The tenant's identity for the preview's top bar. */
  brand: { displayName: string; logoUrl: string | null };
}

const PLACES: readonly PhonePlacement[] = ['bar', 'top', 'hidden'];

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((key, index) => key === b[index]);

/** Writes (or, for the shell's own menu, forgets) the layout on THIS device; the old order goes. */
function keepLayout(places: PhoneMenuPlaces, hidden: string[], isDefault: boolean): void {
  const secure = location.protocol === 'https:' ? '; secure' : '';
  const write = (name: string, value: string) => {
    const life = value === '' ? 'max-age=0' : 'max-age=31536000';
    // biome-ignore lint/suspicious/noDocumentCookie: the theme's reason (`ThemeToggle`): the Cookie Store API is not available on every supported mobile browser; this is a per-device preference
    document.cookie = `${name}=${value}; path=/; ${life}; samesite=lax${secure}`;
  };
  write(
    PHONE_NAV_LAYOUT_COOKIE,
    isDefault ? '' : encodePhoneNavLayout({ bar: places.bar, top: places.top, hidden }),
  );
  write(LEGACY_NAV_ORDER_COOKIE, '');
}

/**
 * 2026-11-05 — Configurações › Menu do app (the product owner: "personalizar hotbar do usuário
 * selecionando quais itens ele quer que entre ali, a ordem dos itens clicando segurando e
 * arrastando, escolhendo se vai ter algum desses itens no header do app", "somente no mobile").
 *
 * A phone drawn with the tenant's identity: its top bar (the administrator's extra items, then the
 * fixed Notificações and Suporte, then the avatar) and its bottom bar. The items of both bars are
 * pressed and dragged sideways to their place (`Reorder`, the stories highlights' library), and the
 * arrow keys move a focused item (WCAG 2.5.7). Under it, every item with its place: Barra, Topo or
 * Oculto. The rules: the bar holds two to six, the top two extras at the most, Início stays in the
 * bar and Perfil never goes to the top (its avatar is already there).
 *
 * Saved on this device (`lib/phone-nav-layout.ts`) until the API keeps it; the route refreshes, so
 * the real phone menu follows at once. The desktop never reads it.
 */
export function PhoneMenuEditor({ items, fixed, initial, defaults, brand }: PhoneMenuEditorProps) {
  const t = useTranslations('admin.menu');
  const router = useRouter();
  const toast = useToast();
  const reduceMotion = useReducedMotion();
  const [bar, setBar] = useState<string[]>(initial.bar);
  const [top, setTop] = useState<string[]>(initial.top);
  const [saved, setSaved] = useState<PhoneMenuPlaces>(initial);
  const [announcement, setAnnouncement] = useState('');
  /** The item whose button must hold the focus once a keyboard move has re-rendered. */
  const refocus = useRef<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const key = refocus.current;
    if (key === null) return;
    refocus.current = null;
    buttons.current.get(key)?.focus({ preventScroll: true });
  });

  const byKey = new Map(items.map((item) => [item.key, item]));
  const hidden = items
    .map((item) => item.key)
    .filter((key) => !bar.includes(key) && !top.includes(key));
  const placeOf = (key: string): PhonePlacement =>
    bar.includes(key) ? 'bar' : top.includes(key) ? 'top' : 'hidden';
  const dirty = !same(bar, saved.bar) || !same(top, saved.top);
  const isDefault = same(bar, defaults.bar) && same(top, defaults.top);

  /** Why a place is refused for an item, or `null` when it may take it. */
  const blocked = (key: string, place: PhonePlacement): string | null => {
    const now = placeOf(key);
    if (now === place) return null;
    if (!placementAllowed(key, place)) return key === 'home' ? t('locked') : t('profileNote');
    if (place === 'bar' && bar.length >= PHONE_BAR_MAX) return t('barFull', { max: PHONE_BAR_MAX });
    if (place === 'top' && top.length >= PHONE_TOP_MAX) return t('topFull', { max: PHONE_TOP_MAX });
    if (now === 'bar' && bar.length <= PHONE_BAR_MIN) return t('barMin', { min: PHONE_BAR_MIN });
    return null;
  };

  const place = (key: string, next: PhonePlacement) => {
    if (blocked(key, next) !== null) return;
    setBar((current) =>
      next === 'bar'
        ? current.includes(key)
          ? current
          : [...current, key]
        : current.filter((value) => value !== key),
    );
    setTop((current) =>
      next === 'top'
        ? current.includes(key)
          ? current
          : [...current, key]
        : current.filter((value) => value !== key),
    );
  };

  const move = (list: 'bar' | 'top', key: string, delta: -1 | 1) => {
    const current = list === 'bar' ? bar : top;
    const from = current.indexOf(key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= current.length) return;
    const next = [...current];
    next.splice(from, 1);
    next.splice(to, 0, key);
    refocus.current = key;
    if (list === 'bar') setBar(next);
    else setTop(next);
    setAnnouncement(
      t('moved', { item: byKey.get(key)?.label ?? '', position: to + 1, total: next.length }),
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, list: 'bar' | 'top', key: string) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(list, key, -1);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      move(list, key, 1);
    }
  };

  const save = () => {
    keepLayout({ bar, top }, hidden, isDefault);
    setSaved({ bar: [...bar], top: [...top] });
    toast.show({ tone: 'success', message: t('saved') });
    router.refresh();
  };

  const restore = () => {
    setBar([...defaults.bar]);
    setTop([...defaults.top]);
  };

  /** One draggable icon of a bar in the preview. */
  const handle = (list: 'bar' | 'top', key: string, index: number, total: number) => {
    const item = byKey.get(key);
    if (!item) return null;
    const Icon = iconFor(item.icon);
    return (
      <Reorder.Item
        key={key}
        value={key}
        data-menu-item={key}
        data-menu-list={list}
        transition={reduceMotion ? { duration: 0 } : undefined}
        whileDrag={reduceMotion ? undefined : { scale: 1.1 }}
        className={cn(
          'cursor-grab touch-pan-y list-none active:cursor-grabbing',
          list === 'bar' ? 'min-w-0 flex-1' : 'shrink-0',
        )}
      >
        <button
          ref={(node) => {
            if (node) buttons.current.set(key, node);
            else buttons.current.delete(key);
          }}
          type="button"
          aria-label={t('item', { item: item.label, position: index + 1, total })}
          aria-describedby="menu-keys"
          onKeyDown={(event) => onKeyDown(event, list, key)}
          className={cn(
            'flex select-none flex-col items-center justify-center text-text-secondary transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
            list === 'bar'
              ? 'w-full gap-1 rounded-full py-1.5'
              : 'size-9 rounded-full bg-brand/10 text-brand',
          )}
        >
          <Icon aria-hidden size={list === 'bar' ? 21 : 18} strokeWidth={1.8} />
          {list === 'bar' ? (
            <span className="w-full truncate px-0.5 text-center text-[9px] font-semibold leading-none">
              {item.label}
            </span>
          ) : null}
        </button>
      </Reorder.Item>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="px-4 text-sm font-normal text-text-secondary md:px-0">{t('intro')}</p>

      {/* ── The phone ── */}
      <Card data-testid="menu-preview" className="flex flex-col items-center gap-3 p-4 md:p-6">
        <SectionTitle variant="micro" className="self-start">
          {t('preview')}
        </SectionTitle>
        <div className="w-full max-w-[340px] overflow-hidden rounded-[36px] border-[5px] border-text/85 bg-bg shadow-lg">
          <div className="flex h-14 items-center justify-between gap-2 border-b border-border bg-bg-secondary px-3">
            <span className="flex min-w-0 items-center text-brand">
              <TenantLogo logoUrl={brand.logoUrl} displayName={brand.displayName} size="topbar" />
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <Reorder.Group
                as="ol"
                axis="x"
                values={top}
                onReorder={setTop}
                aria-label={t('top')}
                data-testid="menu-top"
                className="flex items-center gap-1.5"
              >
                {top.map((key, index) => handle('top', key, index, top.length))}
              </Reorder.Group>
              {fixed.map((item) => {
                const Icon = iconFor(item.icon);
                return (
                  <span
                    key={item.key}
                    title={t('fixed')}
                    className="flex size-9 items-center justify-center rounded-full text-text"
                  >
                    <Icon aria-hidden size={19} strokeWidth={1.7} />
                    <span className="sr-only">{`${item.label}, ${t('fixed')}`}</span>
                  </span>
                );
              })}
              <span aria-hidden className="size-8 rounded-full bg-bg-tertiary" />
            </div>
          </div>
          <div aria-hidden className="flex flex-col gap-3 px-4 py-5">
            <span className="h-28 rounded-2xl bg-bg-tertiary/70" />
            <span className="h-3 w-3/4 rounded-full bg-bg-tertiary/70" />
            <span className="h-3 w-1/2 rounded-full bg-bg-tertiary/70" />
            <span className="h-20 rounded-2xl bg-bg-tertiary/50" />
          </div>
          <div className="px-2.5 pb-3">
            <Reorder.Group
              as="ol"
              axis="x"
              values={bar}
              onReorder={setBar}
              aria-label={t('bar')}
              data-testid="menu-bar"
              className="glass-bar flex w-full items-stretch gap-0.5 rounded-full px-1 py-1"
            >
              {bar.map((key, index) => handle('bar', key, index, bar.length))}
            </Reorder.Group>
          </div>
        </div>
        <div className="grid w-full max-w-[340px] gap-1 text-center">
          <p className="text-xs font-semibold text-text">
            {`${t('bar')} · ${t('barCount', { n: bar.length, max: PHONE_BAR_MAX })}`}
          </p>
          <p className="text-xs font-normal text-text-tertiary">{t('barHelp')}</p>
          <p className="mt-2 text-xs font-semibold text-text">
            {`${t('top')} · ${t('topCount', { n: top.length, max: PHONE_TOP_MAX })}`}
          </p>
          <p className="text-xs font-normal text-text-tertiary">
            {top.length > 0 ? t('topHelp') : t('topEmpty')}
          </p>
        </div>
        <p id="menu-keys" className="sr-only">
          {t('keys')}
        </p>
      </Card>

      {/* ── Every item and its place ── */}
      <Card data-testid="menu-items" className="flex flex-col gap-3 p-4 md:p-6">
        <div className="flex flex-col gap-1">
          <SectionTitle variant="micro">{t('items')}</SectionTitle>
          <p className="text-sm font-normal text-text-secondary">{t('itemsHelp')}</p>
        </div>
        <ul className="flex flex-col divide-y divide-divider">
          {items.map((item) => {
            const Icon = iconFor(item.icon);
            const now = placeOf(item.key);
            const note =
              item.key === 'home' ? t('locked') : item.key === 'profile' ? t('profileNote') : null;
            const groupId = `menu-place-${item.key}`;
            return (
              <li
                key={item.key}
                data-menu-row={item.key}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 min-[420px]:flex-row min-[420px]:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand"
                  >
                    <Icon size={18} strokeWidth={1.8} />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span id={groupId} className="truncate text-sm font-semibold text-text">
                      {item.label}
                    </span>
                    {note ? (
                      <span className="text-[11px] font-normal text-text-tertiary">{note}</span>
                    ) : null}
                  </span>
                </div>
                {/* biome-ignore lint/a11y/useSemanticElements: the shipped SegmentedControl's pattern (pressed buttons in a group), with three places */}
                <div
                  role="group"
                  aria-label={t('placeGroup', { item: item.label })}
                  className="grid shrink-0 grid-cols-3 gap-1 rounded-xl bg-bg-input p-1 min-[420px]:w-[252px]"
                >
                  {PLACES.map((option) => {
                    const reason = blocked(item.key, option);
                    const selected = now === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={selected}
                        disabled={reason !== null}
                        title={reason ?? undefined}
                        data-menu-place={option}
                        onClick={() => place(item.key, option)}
                        className={cn(
                          'inline-flex h-9 min-w-0 items-center justify-center rounded-lg text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-40',
                          selected
                            ? 'bg-card text-brand shadow-sm'
                            : 'text-text-secondary hover:text-text',
                        )}
                      >
                        {t(`place.${option}`)}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="flex flex-col gap-3 px-4 pb-6 md:px-0">
        <p className="text-xs font-normal text-text-tertiary">{t('device')}</p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="md"
            data-testid="menu-restore"
            disabled={isDefault}
            onClick={restore}
            className="mr-auto px-2"
          >
            {t('restore')}
          </Button>
          <Button
            variant="brand"
            size="md"
            data-testid="menu-save"
            disabled={!dirty}
            onClick={save}
            className="min-w-32"
          >
            {t('save')}
          </Button>
        </div>
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
