'use client';

import { Badge, cn } from '@rede-social/ui';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { iconFor, isAreaScreenCurrent, type NavArea, type NavItem } from './nav';
import { slotAccessibleName, slotBadgeStyle, useSlotBadgeLabel } from './realtime/SlotBadgeLabels';

export interface AreaMenuProps {
  area: NavArea;
  /**
   * The bar's own shortcuts (bell, chat …), listed after the area's screens; the slot that owns the
   * area, if any (2026-10-24, the Loja), is left out.
   */
  slots: ReadonlyArray<NavItem>;
  counters: {
    unreadNotifications: number;
    unreadConversations: number;
    conversationsBadge?: 'dot' | 'count';
  };
  /** The profile row, last ("Meu perfil"). */
  profile: { href: string; label: string };
  pathname: string;
}

/**
 * The TopBar's sandwich menu inside an AREA (2026-10-06, the REINE prototype's `TopBarMenu`): the
 * area's screens under its title, a divider, then the bar's shortcuts with their counts and the
 * profile. The bar's right side collapses into it, so the unread-notifications dot rides on the
 * closed button. The notifications row wears REINE's heart; every other row its own glyph.
 *
 * A disclosure, not an ARIA menu: a button with `aria-expanded`/`aria-controls` over a panel of
 * plain links, so the links keep their link semantics and Tab order. A tap outside, Escape (focus
 * back on the button) and a route change close it.
 *
 * 2026-10-22 (the courses area, "· Membros" and "· Cursos"): a screen is marked by its PATH
 * (`isAreaScreenCurrent`: the path, or since 2026-10-23 one of the screen's exact `matches`), so a manager's preview links (`?ver=aluno`) still mark the page; the screens'
 * list carries `data-area-menu-screens`; and the panel scrolls inside the screen when the area's five
 * screens, the shortcuts and the profile do not fit a short phone.
 *
 * 2026-10-24 (the Loja area, owned by a TopBar slot): the slot that owns the area is not one of its
 * shortcuts, its pages are the screens above (Produtos is the Loja's own page). No slot carries a
 * tab's key, so a tab's area keeps every shortcut.
 */
export function AreaMenu({ area, slots, counters, profile, pathname }: AreaMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const labelFor = useSlotBadgeLabel();
  const MenuIcon = iconFor('menu');
  const ProfileIcon = iconFor('user');

  // A route change closes the panel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the pathname IS the trigger
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pending = counters.unreadNotifications;
  const shortcuts = slots.filter((slot) => slot.key !== area.key);
  const row =
    'flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset';

  return (
    <div ref={rootRef} className="relative" data-area-menu={area.key}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={area.menuLabel}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="relative -mr-2 inline-flex h-11 w-11 items-center justify-center rounded-md text-text transition-opacity active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <MenuIcon aria-hidden size={24} strokeWidth={1.5} />
        {pending > 0 && !open ? (
          <span
            aria-hidden
            data-area-menu-dot=""
            className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-bg-secondary"
          />
        ) : null}
      </button>

      {open ? (
        <div
          id={panelId}
          data-area-menu-panel=""
          className="absolute top-full right-0 z-10 mt-2 max-h-[calc(var(--screen-h)-var(--safe-top)-4.5rem)] w-56 overflow-y-auto overscroll-contain rounded-lg border border-border bg-bg-secondary shadow-lg"
        >
          <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
            {area.label}
          </p>
          <ul data-area-menu-screens="">
            {area.screens.map((screen) => {
              const Icon = iconFor(screen.icon);
              const here = isAreaScreenCurrent(pathname, screen);
              return (
                <li key={screen.key}>
                  <Link
                    href={screen.href}
                    aria-current={here ? 'page' : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      row,
                      here
                        ? 'bg-brand/10 text-brand'
                        : 'text-text hover:bg-bg-hover active:bg-bg-tertiary',
                    )}
                  >
                    <Icon aria-hidden size={18} strokeWidth={1.5} />
                    <span>{screen.label}</span>
                    {here ? (
                      <span aria-hidden className="ml-auto h-1.5 w-1.5 rounded-full bg-brand" />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div aria-hidden className="my-1 h-px bg-border" />
          <ul>
            {shortcuts.map((slot) => {
              const Icon = iconFor(slot.badge === 'unreadNotifications' ? 'heart' : slot.icon);
              const count = slot.badge ? counters[slot.badge] : 0;
              const style = slotBadgeStyle(slot.badge, counters.conversationsBadge);
              return (
                <li key={slot.key}>
                  <Link
                    href={slot.href}
                    aria-label={slotAccessibleName(slot.label, slot.badge, count, labelFor, style)}
                    onClick={() => setOpen(false)}
                    className={cn(row, 'text-text hover:bg-bg-hover active:bg-bg-tertiary')}
                  >
                    <Icon aria-hidden size={18} strokeWidth={1.5} />
                    <span>{slot.label}</span>
                    {count > 0 ? (
                      <span aria-hidden className="ml-auto inline-flex">
                        <Badge count={count} variant={style} className="ring-0" />
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
            <li>
              <Link
                href={profile.href}
                onClick={() => setOpen(false)}
                className={cn(row, 'text-text hover:bg-bg-hover active:bg-bg-tertiary')}
              >
                <ProfileIcon aria-hidden size={18} strokeWidth={1.5} />
                <span>{profile.label}</span>
              </Link>
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
