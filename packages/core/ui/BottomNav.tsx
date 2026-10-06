'use client';

import { Badge, cn, useKeyboardInset } from '@rede-social/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { activeTabChrome, activeTabKey, iconFor, type NavItem } from './nav';
import { reselectTab, scrollAppToTop } from './tab-reselect';

export interface BottomNavProps {
  /** Registry tabs: kernel Início first, enabled module tabs, kernel Perfil last (D-40). */
  tabs: ReadonlyArray<NavItem>;
  /** `aria-label` of the `<nav>` (catalog string). */
  label: string;
}

/** The prototype's easing (noz-app curve). */
const EASE = 'cubic-bezier(0.2, 0.715, 0.205, 0.99)';

/**
 * How much height the visual viewport must lose before the bar reads it as the on-screen keyboard.
 * A phone keyboard takes well over 200px; the browser's toolbars collapsing or expanding (iOS
 * Safari) move it by less, and the bar stays for them.
 */
const KEYBOARD_MIN_HEIGHT = 100;

/** The folded pill: its 42px button inside the bar's 6px sides and 1px rim, so it sits centred. */
const COLLAPSED_WIDTH = '56px';

/** The folded button's lift, in the ink of the bar's own shadow. */
const COLLAPSED_SHADOW = '0 1px 1px rgba(15, 23, 42, 0.16), 0 8px 24px rgba(15, 23, 42, 0.16)';

/**
 * Floating glass pill ported from the prototype (UI-SPEC §Shell Contract, D-39): tabs from the
 * registry, icon-only (`aria-label` + `aria-current`), the active chip on `--theme-chip`.
 *
 * Scroll reaction (ported in spirit): the scroll event does not bubble, so a capture-phase document
 * listener filters to the shell's `.app-scroll` root; an accumulator gives hysteresis (shrink after
 * 20px down, restore after 10px up, always full above 48px) so micro-movements never flicker the bar;
 * a route change restores it. Hidden on desktop (`md:hidden`). Under `prefers-reduced-motion` the
 * bar changes shape at once, with no transition.
 *
 * Collapse (2026-10-03, the REINE prototype's "recolher"): on a tab the host marked
 * (`NavItem.collapse`, today Comunidades) the bar does not shrink, it folds into the left corner. The
 * tabs fade out and turn inert (neither a tap, the keyboard nor a screen reader reaches them), and
 * the pill closes on one round button in the brand's colour with the tab's own icon, named by the
 * host. That button takes the scroll root back to the top, which opens the whole bar again, and the
 * focus then goes to the current tab, never dropped on <body>. Scrolling up or changing route opens
 * it too. Never on the media chrome.
 *
 * Media chrome (UI-D-81): ported as a dark-token scope declared by the active tab. While the active
 * tab's nav entry declares `chrome: 'media'`, the `<nav>` carries `data-theme="dark"`, so `.glass-bar`,
 * the active chip and the active icon resolve from the shipped dark theme with no new token; geometry,
 * scroll hysteresis and `md:hidden` are unchanged. On every other tab the attribute is omitted.
 *
 * Keyboard (2026-10-02): while the on-screen keyboard is up the `<nav>` carries
 * `data-keyboard-open` and tokens.css hides it, so the bar never floats over the field being typed
 * in. The signal is the visual viewport (`useKeyboardInset`), read as `keyboardHeight`: what the
 * keyboard took from it, wherever the browser panned the page to reveal the field. Not `inset`: a
 * full pan takes that to 0 with the keyboard still up, and that pan is exactly what brings this
 * bar, bound to the layout viewport, onto the keyboard's top edge, over the field. Not `:focus`
 * either: Android's back gesture closes the keyboard without blurring the field, and a hardware
 * keyboard opens none, so a focus rule kept the bar hidden with no keyboard on screen. Inert
 * without `visualViewport` and under a pinch-zoom: the bar simply stays.
 *
 * Tab dot (2026-10-03): a tab the host marked (`NavItem.dot`, e.g. Eventos while an event is to
 * come) draws the TopBar's red `Badge` dot on its icon's corner, inside the chip (the link clips
 * what spills out of it). Its name stays the tab's own; the dot's description is read after it
 * (`aria-describedby` → a visually hidden span), so the tab is still found by "Eventos".
 *
 * Re-tap (2026-10-06, Instagram's gesture): tapping the tab whose page is already open (Início on
 * the feed) takes the page back to the top instead of navigating (`reselectTab`).
 */
export function BottomNav({ tabs, label }: BottomNavProps) {
  const pathname = usePathname() ?? '';
  const [shrunk, setShrunk] = useState(false);
  const keyboardOpen = useKeyboardInset(true).keyboardHeight > KEYBOARD_MIN_HEIGHT;
  // One id per bar: the rail renders the same tabs, so the descriptions' ids must not repeat.
  const dotId = useId();
  const navRef = useRef<HTMLElement>(null);
  // The scroll root that moved last: the one the folded button takes back to the top.
  const scrollerRef = useRef<HTMLElement | null>(null);
  // Set by the folded button: once the bar opens again, the focus goes to the current tab.
  const refocusRef = useRef(false);

  useEffect(() => {
    let lastEl: EventTarget | null = null;
    let lastY = 0;
    let acc = 0;

    const onScroll = (event: Event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement) || !el.classList.contains('app-scroll')) return;
      scrollerRef.current = el;
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
    // A route change is the member's own move: it never sends the focus into the bar.
    refocusRef.current = false;
  }, [pathname]);

  const active = activeTabKey(tabs, pathname);
  const media = activeTabChrome(tabs, pathname) === 'media';
  const activeTab = tabs.find((tab) => tab.key === active);
  const collapse = media ? undefined : activeTab?.collapse;
  const collapsed = shrunk && collapse !== undefined;
  const small = shrunk && !collapsed;
  const CollapsedIcon = activeTab ? iconFor(activeTab.icon) : null;

  // The folded button leaves once the bar opens: the focus it held goes to the current tab.
  useEffect(() => {
    if (collapsed || !refocusRef.current) return;
    refocusRef.current = false;
    navRef.current
      ?.querySelector<HTMLElement>('a[aria-current="page"]')
      ?.focus({ preventScroll: true });
  }, [collapsed]);

  const backToTop = () => {
    refocusRef.current = true;
    scrollAppToTop(scrollerRef.current);
  };

  return (
    <nav
      ref={navRef}
      aria-label={label}
      data-shell-nav="bottom"
      data-theme={media ? 'dark' : undefined}
      data-keyboard-open={keyboardOpen || undefined}
      data-collapsed={collapsed || undefined}
      className="glass-bar fixed left-3.5 z-50 flex items-center rounded-full px-1.5 py-1 motion-reduce:transition-none! md:hidden"
      style={{
        right: 'auto',
        width: collapsed ? COLLAPSED_WIDTH : 'calc(100% - 28px)',
        bottom: 'calc(var(--safe-bottom) + 8px)',
        transform: small ? 'translateY(12px) scale(0.78)' : 'translateY(0) scale(1)',
        transformOrigin: '50% 100%',
        opacity: small ? 0.92 : 1,
        transition: `width 0.26s ${EASE}, transform 0.3s ${EASE}, opacity 0.3s ${EASE}`,
      }}
    >
      {tabs.map((tab) => {
        const Icon = iconFor(tab.icon);
        const isActive = tab.key === active;
        const describedBy = tab.dot ? `${dotId}-${tab.key}` : undefined;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-label={tab.label}
            aria-describedby={describedBy}
            aria-current={isActive ? 'page' : undefined}
            onClick={(event) => reselectTab(event, pathname, tab.href, scrollerRef.current)}
            inert={collapsed}
            className="grid min-w-0 place-items-center overflow-hidden py-1.5 focus-visible:outline-none motion-reduce:transition-none!"
            style={{
              flex: collapsed ? '0 0 0px' : '1 1 0%',
              padding: collapsed ? 0 : undefined,
              opacity: collapsed ? 0 : 1,
              transition: `flex 0.24s ${EASE}, padding 0.24s ${EASE}, opacity 0.18s ${EASE}`,
            }}
          >
            <span
              className={cn(
                'relative grid h-11 w-[50px] place-items-center rounded-full transition-colors',
                isActive ? 'bg-[var(--theme-chip)] text-brand' : 'text-text-tertiary',
              )}
            >
              <Icon aria-hidden size={23} strokeWidth={isActive ? 2.3 : 1.7} fill="none" />
              {tab.dot ? (
                <span aria-hidden className="absolute top-0.5 right-1.5">
                  <Badge count={1} variant="dot" />
                </span>
              ) : null}
            </span>
            {tab.dot ? (
              <span id={describedBy} className="sr-only">
                {tab.dot.description}
              </span>
            ) : null}
          </Link>
        );
      })}

      {collapsed && collapse && CollapsedIcon ? (
        <button
          type="button"
          onClick={backToTop}
          aria-label={collapse.label}
          className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-brand text-on-brand focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
          style={{ boxShadow: COLLAPSED_SHADOW }}
        >
          <CollapsedIcon aria-hidden size={19} strokeWidth={2.2} fill="none" />
        </button>
      ) : null}
    </nav>
  );
}
