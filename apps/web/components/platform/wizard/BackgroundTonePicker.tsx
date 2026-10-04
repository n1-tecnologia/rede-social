'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
import {
  DARK_TONES,
  DEFAULT_DARK_TONE,
  DEFAULT_LIGHT_TONE,
  isDarkTone,
  isLightTone,
  LIGHT_TONES,
} from '@/lib/bg-tone';
import { useTenantPreview } from '../preview/TenantPreviewProvider';
import { useBrandLook } from './brand-look-context';
import { ToneSelect } from './ToneSelect';

export interface BackgroundTonePickerProps {
  /** Which theme's ground: the light one (the Cores card) or the dark one (Cores do modo escuro). */
  mode: 'light' | 'dark';
}

/**
 * The ground of the app's screens in one theme, chosen among eight PREDEFINED tones and nothing else:
 * no hex field, no colour picker, so a tenant can never land on an unreadable ground. The palette
 * lives in tokens.css alone (Layers 1c and 1d), keyed by the ids of `lib/bg-tone.ts`, so each swatch
 * is an element carrying the id (`data-bg-tone` / `data-dark-tone`) painted with the tone's own
 * variable (`--tone-ground` / `--dtone-ground`): no colour literal here, and the swatch shows exactly
 * what the preview paints, on either panel theme. The first tone is the system's (`null` in the
 * draft), so the default needs no id on the device.
 *
 * A dropdown since 2026-10-03 (the owner's "quero isso em um menu dropdown"), the same one for both
 * modes: `ToneSelect`, a select-only combobox in the step's field look whose trigger shows the
 * chosen tone's swatch and name, and whose list holds the eight tones, each with its swatch and the
 * check on the chosen one. The trigger's name is this label followed by the value ("Cor de fundo
 * Cinza claro (padrão)") and the hint under the label describes it; the keyboard, the closing and
 * the list's place over the neighbouring cards are `ToneSelect`'s. A choice (and the focus reaching
 * the trigger) turns the preview device to that theme, where the change shows. The choice is part of
 * the look the wizard's creation and the Marca tab's save keep (`useBrandLook`, either one's).
 *
 * `data-tone-picker` marks the picker and `data-tone-option` each option (the specs reach them by
 * those); the swatches carry the tone's id as they always did.
 */
export function BackgroundTonePicker({ mode }: BackgroundTonePickerProps) {
  const t = useTranslations('platform.wizard.brand');
  const { draft, update } = useBrandLook();
  const { setTheme } = useTenantPreview();
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const light = mode === 'light';
  const tones: readonly string[] = light ? LIGHT_TONES : DARK_TONES;
  const fallback: string = light ? DEFAULT_LIGHT_TONE : DEFAULT_DARK_TONE;
  const chosen = (light ? draft.lightTone : draft.darkColors.tone) ?? fallback;
  const options = tones.map((tone) => {
    const name = t(`tones.${mode}.${tone}`);
    return { id: tone, label: tone === fallback ? t('tones.default', { tone: name }) : name };
  });

  const pick = (tone: string) => {
    if (light) {
      update({ lightTone: tone !== DEFAULT_LIGHT_TONE && isLightTone(tone) ? tone : null });
    } else {
      update({
        darkColors: {
          ...draft.darkColors,
          tone: tone !== DEFAULT_DARK_TONE && isDarkTone(tone) ? tone : null,
        },
      });
    }
    setTheme(mode);
  };

  return (
    <div data-tone-picker={mode} className="flex min-w-0 flex-col">
      <span id={labelId} className="text-sm text-text-secondary">
        {t('background.title')}
      </span>
      <p id={hintId} className="mt-1 text-xs text-text-tertiary">
        {light ? t('background.lightBody') : t('background.darkBody')}
      </p>
      <div className="mt-3 min-w-0">
        <ToneSelect
          mode={mode}
          options={options}
          value={chosen}
          onChange={pick}
          labelId={labelId}
          describedBy={hintId}
          onFocus={() => setTheme(mode)}
        />
      </div>
    </div>
  );
}
