'use client';

import type { Ref, TextareaHTMLAttributes } from 'react';
import { cn } from '../cn';

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'rows'> {
  /** Explicit id — required so the label, the counter and the error agree (no derived ids). */
  id: string;
  label?: string;
  /** Error message rendered below with `role="alert"` and linked through `aria-describedby`. */
  error?: string;
  /**
   * Character counter `{n}/{max}`, right-aligned and `tabular-nums`, turning `text-danger` at the
   * cap. `aria-live="off"` on purpose (UI-SPEC §Motion & Accessibility): the counter must not be
   * announced on every keystroke — only the field's `maxLength` boundary matters.
   */
  counter?: { value: number; max: number };
  rows?: number;
  containerClassName?: string;
  ref?: Ref<HTMLTextAreaElement>;
}

/**
 * Multiline text field ported from the prototype's inline `EditProfileForm` textarea and normalised
 * to `Input`'s geometry (the prototype's `rounded-2xl` becomes the 12px radius every other field
 * uses): 16px text (iOS zoom guard), tokenised surfaces, brand focus ring, danger error state,
 * `resize-none` and a `rows`-driven height. `maxLength` is passed straight through, so the cap is
 * native as well as visible in the counter.
 */
export function Textarea({
  id,
  label,
  error,
  counter,
  rows = 3,
  className,
  containerClassName,
  ref,
  ...props
}: TextareaProps) {
  const errorId = `${id}-error`;
  const counterId = `${id}-counter`;
  const describedBy = [counter ? counterId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');
  const atCap = counter !== undefined && counter.value >= counter.max;

  return (
    <div className={cn('flex flex-col gap-2', containerClassName)}>
      {label ? (
        <label htmlFor={id} className="text-sm font-normal text-text-secondary">
          {label}
        </label>
      ) : null}

      <textarea
        ref={ref}
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        className={cn(
          'w-full resize-none rounded-xl border border-border bg-bg-input px-4 py-3 text-base text-text transition-colors placeholder:text-text-tertiary',
          'focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-danger focus:border-danger focus:ring-danger/20',
          className,
        )}
        {...props}
      />

      {counter ? (
        <span
          id={counterId}
          aria-live="off"
          className={cn(
            'text-right text-xs tabular-nums',
            atCap ? 'text-danger' : 'text-text-tertiary',
          )}
        >
          {counter.value}/{counter.max}
        </span>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
