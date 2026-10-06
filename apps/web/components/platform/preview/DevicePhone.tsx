'use client';

import { cn } from '@rede-social/ui';
import { type CSSProperties, type ReactNode, type RefObject, useEffect, useRef } from 'react';
import type { PreviewScreenAttributes } from '@/lib/bg-tone';

/** The phone's logical viewport (iPhone 15 Pro / 16): what the app inside lays out against. */
export const DEVICE_SCREEN_W = 393;
export const DEVICE_SCREEN_H = 852;
/** Status-bar band and home-indicator band the app reads as `--safe-top` / `--safe-bottom`. */
const SAFE_TOP = 59;
const SAFE_BOTTOM = 34;
const BEZEL = 11;
const BODY_W = DEVICE_SCREEN_W + BEZEL * 2;
const BODY_H = DEVICE_SCREEN_H + BEZEL * 2;
/** The status bar's clock: a fixed mock-up time, not copy (never translated). */
const STATUS_TIME = '9:41';

export interface DevicePhoneProps {
  /** Accessible name of the whole device (`role="img"`): the panel's catalog, never a brand name. */
  label: string;
  /** Preview theme of the screen: the status bar and the app inside follow it. */
  theme: 'light' | 'dark';
  /**
   * Spread on the screen element: the tenant's `--brand-*` variables (`brandStyleVars`), then the
   * look's (the title font and colours, a dark primary or secondary, the buttons' raw keys of both
   * themes).
   */
  screenStyle?: CSSProperties;
  /**
   * The look's markers on the screen (`previewScreenLook`): the ground tone ids tokens.css
   * keys its Layers 1c and 1d on, and the title / app-name colour markers globals.css keys on.
   * They can never replace `data-device-screen` or `data-theme`, which are rendered after them.
   */
  screenAttributes?: PreviewScreenAttributes;
  /** White status bar and home indicator over a black media stage (the app's Reels chrome). */
  mediaChrome?: boolean;
  /** The source frame's simulated touch: a finger dot for the pointer, press-and-drag scrolling. */
  interactive?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * The phone mockup of `socialroberth-completo` (`components/shell/DeviceFrame.tsx`, itself the
 * social-igoralves / noz-app frame), ported as a PREVIEW device for the platform panel: the same
 * 393×852 screen, 11 px bezel, 62/52 radii, Dynamic Island, status bar, home indicator and simulated
 * touch, and the same three contracts the app inside relies on:
 *
 * 1. `transform: translateZ(0)` on the screen makes it the containing block of every `fixed`
 *    descendant, so nothing inside can escape to the panel;
 * 2. `--screen-w/--screen-h/--safe-top/--safe-bottom` are set inline on the screen (the same names
 *    tokens.css declares), so the app lays out against the device, never against the window;
 * 3. the frame keeps its logical size and is scaled with `transform`, while the outer box reserves
 *    only the SCALED size.
 *
 * What did not come along: the Reine bezel colour and ivory rim (tokens `--device-*` instead) and the
 * full-screen branch (it would cover the panel). The scale is `--device-scale`, set by the caller in
 * CSS per breakpoint, so the device never jumps on hydration and never measures the window; the
 * simulated touch reads the RENDERED scale from the screen's box when a press starts.
 *
 * The screen carries `data-device-screen` + `data-theme`: tokens.css gives a light screen inside a
 * dark panel its light accent pair back. It deliberately carries no `data-brand-scope` — that
 * attribute belongs to the `BrandPreview` frames the panel's specs count. Its own theme attribute is
 * also what scopes the tenant's ground tones (`data-bg-tone`, `data-dark-tone`, both rendered while
 * set): each applies only while the screen's theme is its own, whatever the panel's theme.
 */
export function DevicePhone({
  label,
  theme,
  screenStyle,
  screenAttributes,
  mediaChrome = false,
  interactive = false,
  children,
  className,
}: DevicePhoneProps) {
  const screenRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  useSimulatedTouch(screenRef, dotRef, interactive);

  const reserved: CSSProperties = {
    width: `calc(${BODY_W}px * var(--device-scale, 0.7))`,
    height: `calc(${BODY_H}px * var(--device-scale, 0.7))`,
  };
  const screen = {
    width: DEVICE_SCREEN_W,
    height: DEVICE_SCREEN_H,
    borderRadius: 52,
    overscrollBehavior: 'contain',
    transform: 'translateZ(0)',
    '--screen-w': `${DEVICE_SCREEN_W}px`,
    '--screen-h': `${DEVICE_SCREEN_H}px`,
    '--safe-top': `${SAFE_TOP}px`,
    '--safe-bottom': `${SAFE_BOTTOM}px`,
    ...screenStyle,
  } as CSSProperties;

  return (
    <div role="img" aria-label={label} className={className} style={reserved}>
      <div className="origin-top-left [transform:scale(var(--device-scale,0.7))]">
        <div
          className="rounded-[62px] bg-[var(--device-bezel)] shadow-[var(--device-shadow),0_0_0_1px_var(--device-rim)]"
          style={{ width: BODY_W, height: BODY_H, padding: BEZEL }}
        >
          <div
            ref={screenRef}
            {...screenAttributes}
            data-device-screen
            data-theme={theme}
            className={cn(
              'relative overflow-hidden bg-bg text-text',
              // The dot IS the pointer: links and fields inside must not bring a cursor back.
              interactive && 'cursor-none [&_*]:cursor-none',
            )}
            style={screen}
          >
            {interactive ? (
              <div
                ref={dotRef}
                aria-hidden
                className="pointer-events-none absolute z-[200] h-[30px] w-[30px] rounded-full border-[1.5px] border-white/65 bg-black/15 opacity-0 shadow-[0_1px_6px_rgba(0,0,0,0.2)] transition-[transform,opacity] duration-100"
                style={{ transform: 'translate(-50%, -50%)' }}
              />
            ) : null}
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-x-0 top-0 z-[60] flex items-center justify-between pr-8 pl-10 text-sm font-bold',
                mediaChrome ? 'text-white' : 'text-text',
              )}
              style={{ height: 'var(--safe-top)' }}
            >
              <span className="tabular-nums">{STATUS_TIME}</span>
              <StatusGlyphs />
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute top-[11px] left-1/2 z-[61] h-[37px] w-[125px] -translate-x-1/2 rounded-[20px] bg-black"
            />
            {children}
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute bottom-2 left-1/2 z-[60] h-[5px] w-[140px] -translate-x-1/2 rounded-[3px] opacity-30',
                mediaChrome ? 'bg-white' : 'bg-text',
              )}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The nearest scroller on `axis` from `start` up to the screen; `null` past a `fixed` overlay. */
function findScrollable(
  start: HTMLElement | null,
  axis: 'x' | 'y',
  screen: HTMLElement,
): HTMLElement | null {
  let node = start;
  while (node && node !== screen) {
    const style = getComputedStyle(node);
    const overflow = axis === 'y' ? style.overflowY : style.overflowX;
    const can =
      (overflow === 'auto' || overflow === 'scroll') &&
      (axis === 'y'
        ? node.scrollHeight > node.clientHeight + 1
        : node.scrollWidth > node.clientWidth + 1);
    if (can) return node;
    // Crossed a fixed overlay without finding a scroller: the page behind it must not move.
    if (style.position === 'fixed') return null;
    node = node.parentElement;
  }
  return null;
}

type Drag = {
  v: HTMLElement | null;
  h: HTMLElement | null;
  x: number;
  y: number;
  t: number;
  vx: number;
  vy: number;
  moved: number;
  /** Axis lock, decided on the first stretch of the drag like a real touch. */
  axis: 'x' | 'y' | null;
  sumX: number;
  sumY: number;
  scale: number;
};

/**
 * The source frame's simulated touch, ported as-is in behaviour: a dot replaces the pointer over the
 * screen, press-and-drag scrolls the nearest scroller (axis-locked after 10 px, with release inertia
 * decaying at 0.996^dt) and a press that dragged more than 8 px does not count as a tap. A press on
 * a `[data-scroll-through]` element (the floating tab pill) scrolls what is underneath it. The dot
 * is moved through its ref, never through React state, so the app inside never re-renders for it.
 */
function useSimulatedTouch(
  screenRef: RefObject<HTMLDivElement | null>,
  dotRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const screen = screenRef.current;
    const dot = dotRef.current;
    if (!enabled || !screen || !dot) return;

    let drag: Drag | null = null;
    let suppress = false;
    let fling = 0;
    const scaleOf = () => screen.getBoundingClientRect().width / DEVICE_SCREEN_W || 1;
    const press = (down: boolean) => {
      dot.style.transform = `translate(-50%, -50%) scale(${down ? 0.8 : 1})`;
    };

    const move = (event: MouseEvent) => {
      const rect = screen.getBoundingClientRect();
      const scale = rect.width / DEVICE_SCREEN_W || 1;
      dot.style.left = `${(event.clientX - rect.left) / scale}px`;
      dot.style.top = `${(event.clientY - rect.top) / scale}px`;
      dot.style.opacity = '1';
    };
    const leave = () => {
      dot.style.opacity = '0';
      press(false);
    };
    const down = (event: MouseEvent) => {
      if (event.button !== 0) return;
      cancelAnimationFrame(fling);
      suppress = false;
      let target = event.target as HTMLElement;
      if (target.closest('[data-scroll-through]')) {
        const under = document
          .elementsFromPoint(event.clientX, event.clientY)
          .find(
            (node): node is HTMLElement =>
              node instanceof HTMLElement &&
              screen.contains(node) &&
              !node.closest('[data-scroll-through]'),
          );
        if (under) target = under;
      }
      drag = {
        v: findScrollable(target, 'y', screen),
        h: findScrollable(target, 'x', screen),
        x: event.clientX,
        y: event.clientY,
        t: event.timeStamp,
        vx: 0,
        vy: 0,
        moved: 0,
        axis: null,
        sumX: 0,
        sumY: 0,
        scale: scaleOf(),
      };
      press(true);
      // Like a finger: no text selection (fields still take focus).
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) event.preventDefault();
    };
    const drift = (event: MouseEvent) => {
      const d = drag;
      if (!d) return;
      const dx = event.clientX - d.x;
      const dy = event.clientY - d.y;
      const dt = Math.max(1, event.timeStamp - d.t);
      d.x = event.clientX;
      d.y = event.clientY;
      d.t = event.timeStamp;
      d.vx = 0.75 * d.vx + 0.25 * (dx / dt);
      d.vy = 0.75 * d.vy + 0.25 * (dy / dt);
      d.moved += Math.abs(dx) + Math.abs(dy);
      d.sumX += dx;
      d.sumY += dy;
      if (!d.axis && d.moved > 10) d.axis = Math.abs(d.sumX) > Math.abs(d.sumY) ? 'x' : 'y';
      if (d.v && d.axis !== 'x') d.v.scrollTop -= dy / d.scale;
      if (d.h && d.axis !== 'y') d.h.scrollLeft -= dx / d.scale;
    };
    const up = () => {
      const d = drag;
      drag = null;
      press(false);
      if (!d) return;
      if (d.moved > 8) suppress = true;
      if (Math.abs(d.vx) > 0.05 || Math.abs(d.vy) > 0.05) {
        let { vx, vy } = d;
        let prev = performance.now();
        const step = (now: number) => {
          const dt = now - prev;
          prev = now;
          if (d.v) d.v.scrollTop -= (vy * dt) / d.scale;
          if (d.h) d.h.scrollLeft -= (vx * dt) / d.scale;
          const decay = 0.996 ** dt;
          vx *= decay;
          vy *= decay;
          if (Math.abs(vx) > 0.02 || Math.abs(vy) > 0.02) fling = requestAnimationFrame(step);
        };
        fling = requestAnimationFrame(step);
      }
    };
    // After a DRAG the release is not a tap. Capture on the screen: it runs before the app's own
    // click listeners (the preview's link router included), so the swallowed click reaches none.
    const click = (event: MouseEvent) => {
      if (!suppress) return;
      suppress = false;
      event.stopPropagation();
      event.preventDefault();
    };

    screen.addEventListener('mousemove', move);
    screen.addEventListener('mouseleave', leave);
    screen.addEventListener('mousedown', down);
    screen.addEventListener('click', click, true);
    window.addEventListener('mousemove', drift);
    window.addEventListener('mouseup', up);
    return () => {
      screen.removeEventListener('mousemove', move);
      screen.removeEventListener('mouseleave', leave);
      screen.removeEventListener('mousedown', down);
      screen.removeEventListener('click', click, true);
      window.removeEventListener('mousemove', drift);
      window.removeEventListener('mouseup', up);
      cancelAnimationFrame(fling);
    };
  }, [screenRef, dotRef, enabled]);
}

/** Signal, Wi-Fi and battery, drawn (no image) in `currentColor` — verbatim from the source frame. */
function StatusGlyphs() {
  return (
    <span className="flex items-center gap-[7px]">
      <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor" aria-hidden>
        <rect x="0" y="8" width="3" height="4" rx="1" />
        <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
        <rect x="10" y="3" width="3" height="9" rx="1" />
        <rect x="15" y="0" width="3" height="12" rx="1" opacity="0.4" />
      </svg>
      <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor" aria-hidden>
        <path d="M8 9.5a1.6 1.6 0 1 1 0 3.1 1.6 1.6 0 0 1 0-3.1Z" transform="translate(0,-1.2)" />
        <path d="M8 6.2c1.5 0 2.9.6 3.9 1.6l-1.2 1.2A4 4 0 0 0 8 8a4 4 0 0 0-2.7 1L4.1 7.8a5.5 5.5 0 0 1 3.9-1.6Z" />
        <path
          d="M8 2.8c2.4 0 4.6 1 6.2 2.5L13 6.5A6.9 6.9 0 0 0 8 4.4c-1.9 0-3.7.8-5 2.1L1.8 5.3A8.6 8.6 0 0 1 8 2.8Z"
          opacity="0.9"
        />
      </svg>
      <svg width="25" height="12" viewBox="0 0 25 12" fill="none" aria-hidden>
        <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="currentColor" opacity="0.4" />
        <rect x="2" y="2" width="15" height="8" rx="2" fill="currentColor" />
        <path d="M23.5 4v4a2.2 2.2 0 0 0 0-4Z" fill="currentColor" opacity="0.4" />
      </svg>
    </span>
  );
}
