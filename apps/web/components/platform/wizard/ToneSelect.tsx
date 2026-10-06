'use client';

import { cn } from '@rede-social/ui';
import { SelectMenu } from '@/components/forms/SelectMenu';

export { typeaheadIndex } from '@/components/forms/SelectMenu';

export interface ToneOption {
  /** The tone's id (`lib/bg-tone.ts`): what a choice reports and what its swatch paints. */
  id: string;
  /** Its name, as the trigger and the list show it. */
  label: string;
}

export interface ToneSelectProps {
  /** The theme the tones belong to: it picks the swatch's key, `data-bg-tone` or `data-dark-tone`. */
  mode: 'light' | 'dark';
  options: readonly ToneOption[];
  /** The chosen tone's id; an id outside `options` shows the first option. */
  value: string;
  /** Another tone was chosen (choosing the chosen one again only closes the list). */
  onChange: (id: string) => void;
  /** The visible label's id: it names the list and, followed by the value, the trigger. */
  labelId: string;
  /** The hint's id, read after the trigger's name. */
  describedBy?: string;
  /** The focus reached the trigger. */
  onFocus?: () => void;
}

/** A tone's own paint, by id: tokens.css draws it (Layers 1c and 1d), never a hex here. */
function ToneSwatch({ mode, tone }: { mode: 'light' | 'dark'; tone: string }) {
  const swatch = 'size-6 shrink-0 rounded-full border border-border-secondary';
  return mode === 'light' ? (
    <span
      aria-hidden
      data-theme="light"
      data-bg-tone={tone}
      className={cn(swatch, 'bg-[var(--tone-ground)]')}
    />
  ) : (
    <span
      aria-hidden
      data-theme="dark"
      data-dark-tone={tone}
      className={cn(swatch, 'bg-[var(--dtone-ground)]')}
    />
  );
}

/**
 * The ground tone's dropdown (2026-10-03): `SelectMenu` (the WAI-ARIA select-only combobox, its
 * keyboard, pointer and placement) over the tones of one theme, each with its swatch.
 * `data-tone-option` marks each option, as the specs reach them.
 */
export function ToneSelect({ mode, ...props }: ToneSelectProps) {
  return (
    <SelectMenu
      {...props}
      lead={(tone) => <ToneSwatch mode={mode} tone={tone} />}
      optionAttribute="tone-option"
    />
  );
}
