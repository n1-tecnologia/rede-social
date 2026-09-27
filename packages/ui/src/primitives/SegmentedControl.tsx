'use client';

import { Check } from 'lucide-react';
import { useId } from 'react';
import { cn } from '../cn';

export interface SegmentedOption {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  /**
   * The visible question above the group ("Você vai a este evento?"). When given, the primitive
   * renders it (14/700, `mb-2`) with `id={labelId}`; when omitted, the caller renders its own element
   * carrying `labelId`. Either way the group is named through `aria-labelledby`.
   */
  label?: string;
  /** The id the group's `aria-labelledby` points at. Generated when omitted and `label` is given. */
  labelId?: string;
  /** Exactly two in V1 (not enforced): the grid is `grid-cols-2`. */
  options: SegmentedOption[];
  /** The recorded answer, or `null` for "no answer yet" (both segments idle). */
  value: string | null;
  onChange: (value: string) => void;
  /** The whole group is inert at 50% opacity; the selected option stays visible (D-201). */
  disabled?: boolean;
  /** A write is running: `aria-busy` on the group and both buttons disabled. */
  busy?: boolean;
  className?: string;
}

/**
 * A recorded two-option answer (UI-D-206, [designed] in sketch 006, surface 2): the RSVP pair
 * "Vou" / "Não vou" and the form's "Presencial" / "Online".
 *
 * **A group of pressed buttons, NOT a radiogroup.** Each option is a `<button type="button"
 * aria-pressed>` inside a group role. Radio semantics move the selection with the arrow keys, so
 * merely navigating would WRITE an answer; here focus moves only with Tab, and the only thing that
 * calls `onChange` is a click (or Enter / Space, which the browser turns into one). There is
 * deliberately no key handler at all.
 *
 * **Both options carry the same selected style** (`bg-card text-text shadow-sm` plus a leading brand
 * `Check` 16), so a "Não vou" is recorded with the same weight as a "Vou" (D-205). The small `Check`
 * is the control's only brand ink; the page's one brand fill stays on its CTA.
 *
 * Ships no words: every label comes from the caller's catalog.
 */
export function SegmentedControl({
  label,
  labelId,
  options,
  value,
  onChange,
  disabled = false,
  busy = false,
  className,
}: SegmentedControlProps) {
  const generatedId = useId();
  const groupLabelId = labelId ?? generatedId;
  const inert = disabled || busy;

  return (
    <div className={className}>
      {label !== undefined ? (
        <p id={groupLabelId} className="mb-2 text-sm font-bold text-text">
          {label}
        </p>
      ) : null}
      {/* biome-ignore lint/a11y/useSemanticElements: UI-D-206 fixes a div with the group role, named by the visible question; a `<fieldset>` would need a `<legend>` and brings its own min-width and border quirks inside a grid */}
      <div
        role="group"
        aria-labelledby={groupLabelId}
        aria-busy={busy || undefined}
        aria-disabled={disabled || undefined}
        className={cn(
          'grid grid-cols-2 gap-1 rounded-xl bg-bg-input p-1',
          disabled && 'pointer-events-none opacity-50',
          busy && !disabled && 'cursor-progress opacity-75',
        )}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              disabled={inert}
              onClick={() => onChange(option.value)}
              className={cn(
                'inline-flex h-11 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-bold transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg-input',
                selected ? 'bg-card text-text shadow-sm' : 'text-text-secondary',
                !selected && !inert && 'hover:text-text',
              )}
            >
              {selected ? <Check size={16} aria-hidden className="shrink-0 text-brand" /> : null}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
