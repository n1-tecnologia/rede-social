'use client';

import { cn } from '@tria/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { activeTabKey, iconFor, type NavItem } from './nav';

export interface BottomNavProps {
  /** Registry tabs: kernel Início first, enabled module tabs, kernel Perfil last (D-40). */
  tabs: ReadonlyArray<NavItem>;
  /** `aria-label` of the `<nav>` (catalog string). */
  label: string;
}

/** The prototype's easing (noz-app curve). */
const EASE = 'cubic-bezier(0.2, 0.715, 0.205, 0.99)';

/**
 * Floating glass pill ported from the prototype (UI-SPEC §Shell Contract, D-39): tabs from the
 * registry, icon-only (`aria-label` + `aria-current`), the active chip on `--theme-chip`.
 *
 * Scroll reaction (ported in spirit): the scroll event does not bubble, so a capture-phase document
 * listener filters to the shell's `.app-scroll` root; an accumulator gives hysteresis (shrink after
 * 20px down, restore after 10px up, always full above 48px) so micro-movements never flicker the bar;
 * a route change restores it. The collapse-to-single-button and media modes are deliberately NOT
 * ported. Hidden on desktop (`md:hidden`).
 */
export function BottomNav({ tabs, label }: BottomNavProps) {
  const pathname = usePathname() ?? '';
  const [shrunk, setShrunk] = useState(false);

  useEffect(() => {
    let lastEl: EventTarget | null = null;
    let lastY = 0;
    let acc = 0;

    const onScroll = (event: Event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement) || !el.classList.contains('app-scroll')) return;
      const y = el.scrollTop;
      // A different scroller: register the position without judging direction.
      if (el !== lastEl) {
        lastEl = el;
        lastY = y;
        return;
      }
      const dy = y - lastY;
      lastY = y;
      acc = Math.max(-48, Math.min(48, acc + dy));

      if (y < 48) {
        setShrunk(false);
        acc = 0;
      } else if (acc > 20) {
        setShrunk(true);
      } else if (acc < -10) {
        setShrunk(false);
      }
    };

    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a route change restores the whole bar
  useEffect(() => {
    setShrunk(false);
  }, [pathname]);

  const active = activeTabKey(tabs, pathname);

  return (
    <nav
      aria-label={label}
      data-shell-nav="bottom"
      className="glass-bar fixed left-3.5 z-50 flex items-center rounded-full px-1.5 py-1 md:hidden"
      style={{
        right: 'auto',
        width: 'calc(100% - 28px)',
        bottom: 'calc(var(--safe-bottom) + 8px)',
        transform: shrunk ? 'translateY(12px) scale(0.78)' : 'translateY(0) scale(1)',
        transformOrigin: '50% 100%',
        opacity: shrunk ? 0.92 : 1,
        transition: `width 0.26s ${EASE}, transform 0.3s ${EASE}, opacity 0.3s ${EASE}`,
      }}
    >
      {tabs.map((tab) => {
        const Icon = iconFor(tab.icon);
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-label={tab.label}
            aria-current={isActive ? 'page' : undefined}
            className="grid min-w-0 flex-1 place-items-center overflow-hidden py-1.5 focus-visible:outline-none"
          >
            <span
              className={cn(
                'grid h-11 w-[50px] place-items-center rounded-full transition-colors',
                isActive ? 'bg-[var(--theme-chip)] text-brand' : 'text-text-tertiary',
              )}
            >
              <Icon aria-hidden size={23} strokeWidth={isActive ? 2.3 : 1.7} fill="none" />
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
