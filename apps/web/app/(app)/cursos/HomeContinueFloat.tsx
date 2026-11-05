'use client';

import { cn } from '@rede-social/ui';
import { Play, X } from 'lucide-react';
import { useEffect, useState } from 'react';

/** The session key that remembers a dismissed card, per lesson (a new lesson brings it back). */
const DISMISSED_KEY = 'courses.home.continue-dismissed';

function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(lessonId: string): void {
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, lessonId);
  } catch {
    // A blocked storage only means the card comes back on the next visit.
  }
}

/**
 * The floating "Continuar assistindo" (2026-10-26, the academy reference's corner card): on a
 * desktop, while Início's "Continue de onde parou" is out of view, the lesson the member stopped at
 * waits at the bottom-right corner, one tap away: its course's mark, "Continuar assistindo", the
 * lesson's title, "{course} · {percent}%" and the course's share as a 2px band. "Fechar" hides it for
 * the rest of the session (for that lesson; `sessionStorage`, nothing is written anywhere else).
 *
 * Only for a lesson in progress (the hero's `retomando`), never on a phone (the tab bar owns that
 * corner). It renders at the end of Início, outside every card, so nothing transformed holds it.
 */
export function HomeContinueFloat({
  lessonId,
  href,
  eyebrow,
  title,
  meta,
  percent,
  closeLabel,
  watchId,
}: {
  lessonId: string;
  href: string;
  /** "Continuar assistindo". */
  eyebrow: string;
  title: string;
  /** "{course} · {percent}%". */
  meta: string;
  percent: number;
  /** "Fechar". */
  closeLabel: string;
  /** The resume section's id: the card shows only while that section is out of view. */
  watchId: string;
}) {
  const [dismissed, setDismissed] = useState(true);
  const [outOfView, setOutOfView] = useState(false);

  useEffect(() => {
    setDismissed(readDismissed() === lessonId);
  }, [lessonId]);

  useEffect(() => {
    const target = document.getElementById(watchId);
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setOutOfView(entry ? !entry.isIntersecting : false),
      { threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [watchId]);

  const share = Math.min(100, Math.max(0, Math.round(percent)));
  const shown = !dismissed && outOfView;

  return (
    <div
      data-testid="courses-home-continue"
      data-shown={shown}
      hidden={!shown}
      className={cn(
        'fixed right-6 bottom-6 z-40 w-[300px] max-md:hidden',
        shown && 'animate-swap-in motion-reduce:animate-none',
      )}
    >
      <div className="ms-panel relative overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <a
          href={href}
          className="group flex items-center gap-3 p-3 pr-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
        >
          <span
            aria-hidden
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand ring-1 ring-brand/25"
          >
            <Play size={16} fill="currentColor" className="ml-0.5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">
              {eyebrow}
            </span>
            <span className="truncate text-sm font-semibold leading-snug text-text">{title}</span>
            <span className="mt-0.5 truncate text-[11px] font-normal text-text-secondary tabular-nums">
              {meta}
            </span>
          </span>
        </a>
        <button
          type="button"
          aria-label={closeLabel}
          onClick={() => {
            writeDismissed(lessonId);
            setDismissed(true);
          }}
          className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <X aria-hidden size={14} />
        </button>
        <span aria-hidden className="block h-1 bg-bg-tertiary">
          <span className="block h-full bg-brand" style={{ width: `${share}%` }} />
        </span>
      </div>
    </div>
  );
}
