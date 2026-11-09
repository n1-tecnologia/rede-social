'use client';

import { cn } from '@rede-social/ui';
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react';

/**
 * The player's content tabs (2026-10-26, the academy reference's "Descrição | Materiais"): a
 * segmented tablist over panels the server already rendered (the description, the materials). A
 * tab without content is never passed, and with ONE tab the list is not drawn at all: the panel
 * shows alone. Arrow keys, Home and End move between tabs (the ARIA tabs pattern).
 */
export interface LessonTab {
  key: string;
  label: string;
  icon?: ReactNode;
  content: ReactNode;
}

export function LessonTabs({ label, tabs }: { label: string; tabs: LessonTab[] }) {
  const [active, setActive] = useState(tabs[0]?.key ?? '');
  const baseId = useId();
  if (tabs.length === 0) return null;
  if (tabs.length === 1) return <div data-testid="lesson-tabs">{tabs[0]?.content}</div>;

  const tabId = (key: string) => `${baseId}-tab-${key}`;
  const panelId = (key: string) => `${baseId}-panel-${key}`;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    setActive(tab.key);
    document.getElementById(tabId(tab.key))?.focus();
  };

  return (
    <div data-testid="lesson-tabs" className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={label}
        className="ms-chip-surface flex w-fit gap-1 rounded-2xl border border-border bg-bg-tertiary p-1"
      >
        {tabs.map((tab, index) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              id={tabId(tab.key)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId(tab.key)}
              tabIndex={selected ? 0 : -1}
              data-tab={tab.key}
              onClick={() => setActive(tab.key)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                'inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                selected
                  ? 'bg-card text-text shadow-[0_1px_3px_rgba(0,0,0,0.18)]'
                  : 'text-text-tertiary hover:text-text',
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.key}
          id={panelId(tab.key)}
          role="tabpanel"
          aria-labelledby={tabId(tab.key)}
          hidden={tab.key !== active}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
