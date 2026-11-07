'use client';

import { ChevronDown } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';

const SELECT_CLASS =
  'w-full min-h-11 min-w-0 appearance-none rounded-xl border border-border bg-bg-input px-4 py-3 pr-10 text-base text-text transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50';

export interface SheetSelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The line under the field (`role="alert"`): the select is `aria-invalid` and described by it. */
  error?: string;
  /** The helper under the field, linked with `aria-describedby`. */
  helper?: string;
  /** A second helper line (12.2-16: why some branches are left out for a public question). */
  extraHelper?: string;
  disabled?: boolean;
  children: ReactNode;
}

/**
 * A native `<select>` in the shipped `Input` look (UI-D-647, UI-D-669): the label above (14/400 secondary), the
 * 16px control with a trailing `ChevronDown` 18, a 12/400 tertiary helper and a `role="alert"` error line. Native
 * on purpose: nothing a phone's own picker already does is rebuilt here. Shared by the "Etapa" and "Ramo"
 * fields of the question sheet (moved out of `ConditionEditor.tsx` in 12.2-16).
 */
export function SheetSelect({
  id,
  label,
  value,
  onChange,
  error,
  helper,
  extraHelper,
  disabled,
  children,
}: SheetSelectProps) {
  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;
  const extraId = `${id}-helper-extra`;
  // A change the owner refuses leaves its value as it was, and the control must show that: the native element
  // already took the picked option, so it is put back to the controlled value after every render (the snap-back
  // of the step field, UI-D-647).
  const element = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (element.current && element.current.value !== value) element.current.value = value;
  });
  // The error replaces the helper (the sketch draws one or the other), and the field is described by what shows.
  const shownHelper = error ? undefined : helper;
  const shownExtra = error ? undefined : extraHelper;
  const describedBy = [
    error ? errorId : null,
    shownHelper ? helperId : null,
    shownExtra ? extraId : null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-normal text-text-secondary">
        {label}
      </label>
      <div className="relative">
        <select
          ref={element}
          id={id}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={error ? `${SELECT_CLASS} border-danger` : SELECT_CLASS}
          onChange={(event) => onChange(event.target.value)}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          size={18}
          className="pointer-events-none absolute top-1/2 right-[14px] -translate-y-1/2 text-text-tertiary"
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="break-words text-sm text-danger">
          {error}
        </p>
      ) : null}
      {shownHelper ? (
        <span id={helperId} className="text-xs font-normal text-text-tertiary">
          {shownHelper}
        </span>
      ) : null}
      {shownExtra ? (
        <span id={extraId} className="text-xs font-normal text-text-tertiary">
          {shownExtra}
        </span>
      ) : null}
    </div>
  );
}
