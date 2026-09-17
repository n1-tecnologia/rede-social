'use client';

import { hexColorSchema, NEUTRAL_BRAND } from '@tria/contracts/branding';
import { Input } from '@tria/ui';
import { useState } from 'react';

export interface ColorFieldProps {
  id: string;
  name: string;
  label: string;
  /** The hex as typed (the schema lower-cases on the server). */
  value: string;
  onChange: (hex: string) => void;
  error?: string;
  /** Accessible name of the native colour picker. */
  pickLabel: string;
  placeholder: string;
}

/**
 * One source colour of the brand (UI-SPEC ColorField; reused by 02-14's BrandingForm): a 44×44
 * swatch wrapping a native `<input type="color">` next to the hex `Input`. The swatch always shows
 * the LAST VALID hex — an invalid keystroke keeps it (E11/E12 partial) — and a picked colour writes
 * its lower-cased hex into the text field. The value only reaches a `style` after `hexColorSchema`
 * accepted it (T-02-63).
 */
export function ColorField({
  id,
  name,
  label,
  value,
  onChange,
  error,
  pickLabel,
  placeholder,
}: ColorFieldProps) {
  const parsed = hexColorSchema.safeParse(value);
  const [lastValid, setLastValid] = useState(parsed.success ? parsed.data : null);
  const swatch = parsed.success ? parsed.data : lastValid;

  const update = (next: string) => {
    const check = hexColorSchema.safeParse(next);
    if (check.success) setLastValid(check.data);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm text-text-secondary">
        {label}
      </label>
      <div className="flex items-start gap-3">
        <span
          className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-border bg-bg-tertiary"
          style={swatch ? { backgroundColor: swatch } : undefined}
        >
          <input
            type="color"
            aria-label={pickLabel}
            value={swatch ?? NEUTRAL_BRAND.primary}
            onChange={(event) => update(event.target.value.toLowerCase())}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </span>
        <Input
          id={id}
          name={name}
          value={value}
          onChange={(event) => update(event.target.value)}
          placeholder={placeholder}
          maxLength={7}
          inputMode="text"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          error={error}
          className="uppercase"
          containerClassName="min-w-0 flex-1"
        />
      </div>
    </div>
  );
}
