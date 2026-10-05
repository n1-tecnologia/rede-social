'use client';

import { Button, cn } from '@rede-social/ui';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { hexOrNull } from '@/lib/bg-tone';

/** One of a gradient's two colours: its hex input in the box and its half of the swatch. */
export interface GradientStop {
  /** The hex input's id (and name). */
  id: string;
  /** Accessible name of the hex input: names the colour AND the mode (the box shows no label). */
  name: string;
  /** Accessible name of the native colour picker on this colour's half of the swatch. */
  pickLabel: string;
  /** The tenant's own colour: a valid hex, or `null` for the system's (then `fallback` shows). */
  value: string | null;
  /** The system's colour the field shows while `value` is `null`. */
  fallback: string;
  /** Only ever a VALID hex, lower-cased: a partial one never reaches the draft or the preview. */
  onChange: (hex: string) => void;
}

export interface GradientColorFieldProps {
  /** The field's visible label, which names its group ("Cor do botão"). */
  label: string;
  placeholder: string;
  /** The gradient's FIRST colour: the swatch's left half, the box's first hex. */
  start: GradientStop;
  /** Its LAST colour: the swatch's right half, the box's second hex. */
  end: GradientStop;
  /** Back to the system's colours: BOTH of them. */
  onReset: () => void;
  resetLabel: string;
  /**
   * The reset's accessible name, which starts with `resetLabel` and names the field: a card holds
   * several resets with the same visible label.
   */
  resetName: string;
  /** Said in the reset's place while both colours are the system's ("Automática"). */
  fallbackLabel: string;
  /** Focus anywhere in the field (either hex, either picker): the caller turns the preview. */
  onFocus?: () => void;
}

type Stop = 'start' | 'end';

/** The swatch's halves and the box's hex inputs, in order: the first colour, then the last. */
const STOPS: readonly Stop[] = ['start', 'end'];

/**
 * A half's cue, drawn over its invisible picker: a ring in the ground's colour under the pointer,
 * and under the keyboard's focus that ring with the brand's inside it, two colours so one of them
 * shows on any colour (the picker itself is transparent, its own outline never shows).
 */
const HALF_CUE =
  'pointer-events-none absolute inset-0 peer-hover:ring-2 peer-hover:ring-bg/70 peer-hover:ring-inset peer-focus-visible:ring-2 peer-focus-visible:ring-bg peer-focus-visible:ring-inset peer-focus-visible:outline-2 peer-focus-visible:outline-brand peer-focus-visible:-outline-offset-4';

/** Each half's corners: the outer side keeps the swatch's round, the inner side a smaller one. */
const HALF_SHAPE: Record<Stop, string> = {
  start: 'rounded-l-xl rounded-r-md',
  end: 'rounded-l-md rounded-r-xl',
};

/**
 * Each hex input, bare inside the box that draws the `Input`'s surface and ring. The first keeps
 * the `Input`'s left padding, so its code lines up with the codes of the fields below it.
 */
const HEX =
  'min-w-0 flex-1 bg-transparent py-3 text-base text-text uppercase placeholder:text-text-tertiary focus:outline-none';
const HEX_PADDING: Record<Stop, string> = { start: 'pr-2 pl-4', end: 'pr-4 pl-2' };

/**
 * One gradient of the look (the buttons' "Degradê", in Personalização and the Marca tab): its two colours in ONE
 * field, the way `PreviewColorField` holds one, and with `ColorField`'s look (the 44px swatch, the
 * `Input`'s box and focus ring). The swatch is two halves with a gap between them, one per
 * colour, each painted with its colour alone, in the order of the codes beside it: the left half
 * is the first colour and holds its native picker, the right half the last one (the gradient
 * itself shows on the buttons of the samples and the phone). Beside it, one box holds both hex
 * inputs, the first, an arrow, then the last, each named for its colour and its mode; the box
 * takes the focus ring of either. The field is a group named by its visible label.
 *
 * As in `PreviewColorField`, the field always shows colours (the tenant's, or the system's
 * `fallback`), and the typing stays local: only a complete `#rrggbb` reaches the caller (so the
 * device and the derived colours never see a partial hex), the swatch never paints a partial one,
 * and an input that loses the focus with a partial one shows the stored colour again (moving to
 * the other colour included, so no half-typed code stays behind beside the swatch). ONE reset
 * clears BOTH colours, and shows while either of them is the tenant's own; while neither is, the
 * quiet label stands in its place. The reset is a plain button, never a submit, so Enter in the
 * field still belongs to the step's "Continuar".
 */
export function GradientColorField({
  label,
  placeholder,
  start,
  end,
  onReset,
  resetLabel,
  resetName,
  fallbackLabel,
  onFocus,
}: GradientColorFieldProps) {
  const stops: Record<Stop, GradientStop> = { start, end };
  const [typed, setTyped] = useState<Record<Stop, string | null>>({ start: null, end: null });
  const stored = (stop: Stop) => stops[stop].value ?? stops[stop].fallback;
  // The last valid colour of each stop: the typed one once complete, else the stored one.
  const paint = (stop: Stop) => hexOrNull(typed[stop]) ?? stored(stop);

  const change = (stop: Stop, next: string) => {
    setTyped((prev) => ({ ...prev, [stop]: next }));
    const hex = hexOrNull(next);
    if (hex) stops[stop].onChange(hex);
  };
  const leave = (stop: Stop) =>
    setTyped((prev) => (prev[stop] === null ? prev : { ...prev, [stop]: null }));
  // The reset leaves with its own click (the quiet label takes its place), so the focus goes to
  // the first colour's hex, never dropped on <body> (WCAG 2.4.3, as `PreviewColorField` does).
  const reset = () => {
    setTyped({ start: null, end: null });
    onReset();
    document.getElementById(start.id)?.focus();
  };

  const hexInput = (stop: Stop) => (
    <input
      id={stops[stop].id}
      name={stops[stop].id}
      aria-label={stops[stop].name}
      value={typed[stop] ?? stored(stop)}
      onChange={(event) => change(stop, event.target.value)}
      onBlur={() => leave(stop)}
      placeholder={placeholder}
      maxLength={7}
      inputMode="text"
      autoCapitalize="off"
      autoComplete="off"
      spellCheck={false}
      className={cn(HEX, HEX_PADDING[stop])}
    />
  );

  return (
    <fieldset data-gradient-color={start.id} className="min-w-0" onFocus={onFocus}>
      <legend className="text-sm text-text-secondary">{label}</legend>
      <div className="mt-2 flex items-start gap-3">
        {/* Two halves with a gap between them, each painted with its own colour alone. */}
        <span data-gradient-swatch className="flex h-11 w-11 shrink-0 gap-1">
          {STOPS.map((stop) => (
            <span
              key={stop}
              data-gradient-stop={stop}
              className={cn(
                'relative flex-1 overflow-hidden border border-border',
                HALF_SHAPE[stop],
              )}
              style={{ backgroundColor: paint(stop) }}
            >
              <input
                type="color"
                aria-label={stops[stop].pickLabel}
                value={paint(stop)}
                onChange={(event) => change(stop, event.target.value.toLowerCase())}
                className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
              <span aria-hidden="true" className={cn(HALF_CUE, HALF_SHAPE[stop])} />
            </span>
          ))}
        </span>
        <div className="flex min-w-0 flex-1 items-center rounded-xl border border-border bg-bg-input transition-colors focus-within:border-brand focus-within:ring-1 focus-within:ring-brand/20">
          {hexInput('start')}
          <ArrowRight aria-hidden size={16} className="shrink-0 text-text-tertiary" />
          {hexInput('end')}
        </div>
      </div>
      <div className="mt-2 flex min-h-9 flex-wrap items-center justify-between gap-2">
        {start.value || end.value ? (
          <Button type="button" variant="ghost" size="sm" aria-label={resetName} onClick={reset}>
            {resetLabel}
          </Button>
        ) : (
          <span data-preview-color-fallback className="text-xs text-text-tertiary">
            {fallbackLabel}
          </span>
        )}
      </div>
    </fieldset>
  );
}
