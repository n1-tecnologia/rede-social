'use client';

import { Search, X } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { cn } from '../cn';
import { IconButton } from './IconButton';

export interface SearchBarProps {
  /** Controlled value — the CALLER owns the debounce (`useDebounce`), so timing is per call site. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name of the 44x44 clear control — required, it is icon-only. */
  clearLabel: string;
  /** Accessible name of the field itself — required, the pill carries no visible label. */
  ariaLabel: string;
  /** Explicit id when a caller needs to address the field (tests, `htmlFor`). */
  id?: string;
  className?: string;
}

/**
 * The search pill, ported from `reference/frontend-design/components/explore/SearchBar.tsx` with
 * UI-D-04's two deliberate departures from the prototype: the field is 16px (the UI-SPEC writes it
 * `text-16`; this repo's realisation of that size is `text-base`, exactly as `Input` and `Textarea`
 * already ship it) and `h-11` (44px) rather than the prototype's 14px / `py-2.5`. A 14px input zooms
 * the viewport on iOS Safari on focus, and 44px is the minimum touch target — on a mobile-first PWA
 * the prototype's geometry is a bug, not a style.
 *
 * Fully controlled and debounce-free: `/membros` debounces 300 ms into `?q=`, and Phase 8's member
 * management reuses the component with its own timing.
 *
 * The clear control renders ONLY when the value is non-empty, as a real 44x44 `IconButton` in the tab
 * order (UI-SPEC §Motion & Accessibility), never a bare glyph.
 */
export function SearchBar({
  value,
  onChange,
  placeholder,
  clearLabel,
  ariaLabel,
  id,
  className,
}: SearchBarProps) {
  return (
    <div className={cn('relative', className)}>
      <Search
        aria-hidden
        size={18}
        className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-text-tertiary"
      />

      <input
        id={id}
        type="search"
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        className={cn(
          'h-11 w-full rounded-full border border-transparent bg-bg-input pr-12 pl-10 text-base text-text transition-colors placeholder:text-text-tertiary',
          'focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20',
          '[&::-webkit-search-cancel-button]:appearance-none',
        )}
      />

      {value.length > 0 ? (
        <IconButton
          icon={X}
          label={clearLabel}
          size={16}
          onClick={() => onChange('')}
          className="absolute top-1/2 right-1 -translate-y-1/2 text-text-secondary"
        />
      ) : null}
    </div>
  );
}
