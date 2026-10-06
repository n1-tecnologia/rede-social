'use client';

import { Button } from '@rede-social/ui';
import { type FocusEvent, type ReactNode, useState } from 'react';
import { hexOrNull } from '@/lib/bg-tone';
import { ColorField } from '../ColorField';

export interface PreviewColorFieldProps {
  id: string;
  label: string;
  /** Accessible name of the native colour picker: names the colour AND the mode. */
  pickLabel: string;
  placeholder: string;
  /** The tenant's own colour: a valid hex, or `null` for the system's (then `fallback` shows). */
  value: string | null;
  /** The system's colour the field shows while `value` is `null`. */
  fallback: string;
  /** Only ever a VALID hex, lower-cased: a partial one never reaches the draft or the preview. */
  onChange: (hex: string) => void;
  /** Back to the system's colour (`null`). */
  onReset: () => void;
  resetLabel: string;
  /**
   * The reset's accessible name, which starts with `resetLabel` and names the field: a card holds
   * several resets with the same visible label.
   */
  resetName: string;
  /** Said in the reset's place while the system's colour is in use ("Automática", "Padrão"). */
  fallbackLabel: string;
  /** Focus anywhere in the field (the hex or the native picker): the caller turns the preview. */
  onFocus?: () => void;
  /** A line beside the reset (a contrast hint). */
  children?: ReactNode;
}

/**
 * One colour of the look beyond the pair (the dark mode's pair, the titles' and the app name's inks,
 * the buttons' colours; Personalização and the Marca tab, saved with the tenant since 2026-10-03):
 * the shared `ColorField` (swatch, native picker, hex) over a value that may be the system's
 * own. The field always shows a colour: the tenant's, or the system's (`fallback`) with a quiet
 * "Automática"/"Padrão" where the reset would be, so nothing reads as empty. The typing stays local:
 * only a complete `#rrggbb` reaches the draft (so the device and the derived colours never see a
 * partial hex, and `deriveBrandColors` never throws on one), and leaving the field with a partial one
 * shows the stored colour again. The reset is a plain button, never a submit, so Enter in the field
 * still belongs to the step's "Continuar".
 */
export function PreviewColorField({
  id,
  label,
  pickLabel,
  placeholder,
  value,
  fallback,
  onChange,
  onReset,
  resetLabel,
  resetName,
  fallbackLabel,
  onFocus,
  children,
}: PreviewColorFieldProps) {
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? value ?? fallback;

  const change = (next: string) => {
    setTyped(next);
    const hex = hexOrNull(next);
    if (hex) onChange(hex);
  };
  // Focus moving between the hex and the picker stays in the field; leaving it drops a partial hex.
  const leave = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node && event.currentTarget.contains(next))) setTyped(null);
  };
  // The reset leaves with its own click (the field shows the fallback label in its place), so the
  // focus goes to the field's hex, which now shows the system's colour: never dropped on <body>
  // (WCAG 2.4.3, review BTN-CARD-4). Focusing it turns the preview, as any focus in the field does.
  const reset = () => {
    setTyped(null);
    onReset();
    document.getElementById(id)?.focus();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: it only hears the focus bubbling from the field's own native controls; the wrapper adds no interaction.
    <div
      data-preview-color={id}
      className="flex min-w-0 flex-col gap-2"
      onFocus={onFocus}
      onBlur={leave}
    >
      <ColorField
        id={id}
        name={id}
        label={label}
        value={shown}
        onChange={change}
        pickLabel={pickLabel}
        placeholder={placeholder}
      />
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        {children}
        {value ? (
          <Button type="button" variant="ghost" size="sm" aria-label={resetName} onClick={reset}>
            {resetLabel}
          </Button>
        ) : (
          <span data-preview-color-fallback className="text-xs text-text-tertiary">
            {fallbackLabel}
          </span>
        )}
      </div>
    </div>
  );
}
