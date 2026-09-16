'use client';

import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import { cn } from '../cn';

export interface TabItem {
  key: string;
  label: string;
  /** Render the tab as a link; the consumer marks the active one through `value`. */
  href?: string;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  /** Accessible name of the tablist. */
  label: string;
  /** Id of the panel the tabs control (sets `aria-controls`). */
  panelId?: string;
  className?: string;
}

/**
 * Underline tabs with a horizontal scroller that keeps the active tab centred. Roving tabindex,
 * ArrowLeft/ArrowRight/Home/End move the selection (calling `onChange`).
 */
export function Tabs({ items, value, onChange, label, panelId, className }: TabsProps) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLElement | null>(null);

  // Re-centre the active tab whenever the selection changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` is the trigger, read through the ref
  useEffect(() => {
    const el = activeRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }, [value]);

  const tabId = (key: string) => `${baseId}-tab-${key}`;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const count = items.length;
    if (count === 0) return;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % count;
    else if (event.key === 'ArrowLeft') next = (index - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    if (next === null) return;
    event.preventDefault();
    const item = items[next];
    if (!item) return;
    onChange(item.key);
    const target = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(tabId(item.key))}`);
    target?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className={cn('flex overflow-x-auto scrollbar-none', className)}
    >
      {items.map((item, index) => {
        const active = item.key === value;
        const shared = {
          id: tabId(item.key),
          role: 'tab' as const,
          'aria-selected': active,
          'aria-controls': panelId,
          tabIndex: active ? 0 : -1,
          ref: active
            ? (node: HTMLElement | null) => {
                activeRef.current = node;
              }
            : undefined,
          onKeyDown: (event: KeyboardEvent<HTMLElement>) => onKeyDown(event, index),
          className: cn(
            'relative shrink-0 whitespace-nowrap px-4 py-3 text-sm transition-colors',
            active ? 'font-bold text-text' : 'text-text-tertiary active:text-text-secondary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
          ),
        };
        const content: ReactNode = (
          <>
            {item.label}
            {active ? (
              <span
                aria-hidden
                className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-brand"
              />
            ) : null}
          </>
        );

        if (item.href !== undefined) {
          return (
            <a key={item.key} href={item.href} {...shared}>
              {content}
            </a>
          );
        }
        return (
          <button key={item.key} type="button" onClick={() => onChange(item.key)} {...shared}>
            {content}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  id: string;
  children: ReactNode;
  className?: string;
}

/** The panel a `Tabs` controls (`role="tabpanel"`). */
export function TabPanel({ id, children, className }: TabPanelProps) {
  return (
    <section id={id} role="tabpanel" className={className}>
      {children}
    </section>
  );
}
