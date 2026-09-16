'use client';

import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../cn';

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'type' | 'role'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name (the row's visible text is usually elsewhere). */
  label: string;
  /** While the change persists: announces busy and ignores clicks. */
  busy?: boolean;
}

/** Toggle: `role="switch"`, brand track when on, tertiary when off. */
export function Switch({
  checked,
  onChange,
  label,
  busy = false,
  disabled,
  className,
  onClick,
  ...props
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || busy) return;
        onChange(!checked);
      }}
      className={cn(
        'inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors',
        checked ? 'justify-end bg-brand' : 'justify-start bg-bg-tertiary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span aria-hidden className="h-5 w-5 rounded-full bg-white shadow" />
    </button>
  );
}
