'use client';

import type { LucideIcon } from 'lucide-react';
import type { InputHTMLAttributes, Ref } from 'react';
import { cn } from '../cn';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'id'> {
  /** Explicit id — required so the label, the error message and the input agree (no derived ids). */
  id: string;
  label?: string;
  /** Error message rendered below with `role="alert"` and linked through `aria-describedby`. */
  error?: string;
  /** Leading 18px icon. */
  icon?: LucideIcon;
  containerClassName?: string;
  ref?: Ref<HTMLInputElement>;
}

/** The native temporal types, which iOS WebKit draws as a menulist button (see the guard below). */
const TEMPORAL_TYPES = new Set(['date', 'time', 'datetime-local', 'month', 'week']);

/**
 * Text input: 16px text (iOS zoom guard), tokenised surfaces, brand focus ring, danger error state.
 * iOS date/time guard (PDF item #11): iOS turns `appearance: auto` on the temporal types into
 * menulist-button, which forces content-box sizing plus its own padding and pushes a `w-full` field
 * past the screen; only `appearance-none` skips that (`min-w-0` alone does not), and the value box
 * keeps a 24px floor (WebKit would collapse an empty one) and the left alignment of the others.
 */
export function Input({
  id,
  label,
  error,
  icon: Icon,
  className,
  containerClassName,
  ref,
  ...props
}: InputProps) {
  const errorId = `${id}-error`;
  const temporal = typeof props.type === 'string' && TEMPORAL_TYPES.has(props.type);

  return (
    <div className={cn('flex flex-col gap-2', containerClassName)}>
      {label ? (
        <label htmlFor={id} className="text-sm font-normal text-text-secondary">
          {label}
        </label>
      ) : null}

      <div className="relative">
        {Icon ? (
          <Icon
            aria-hidden
            size={18}
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-text-tertiary"
          />
        ) : null}

        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            'w-full min-w-0 rounded-xl border border-border bg-bg-input px-4 py-3 text-base text-text transition-colors placeholder:text-text-tertiary',
            'focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20',
            'disabled:cursor-not-allowed disabled:opacity-50',
            temporal &&
              'appearance-none [&::-webkit-date-and-time-value]:min-h-6 [&::-webkit-date-and-time-value]:text-left',
            Icon && 'pl-10',
            error && 'border-danger focus:border-danger focus:ring-danger/20',
            className,
          )}
          {...props}
        />
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
