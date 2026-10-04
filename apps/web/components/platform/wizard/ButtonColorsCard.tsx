'use client';

import { buttonGradient } from '@rede-social/core/ui';
import { Button, Card, SectionTitle, SegmentedControl, StatusPill } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import {
  type ButtonColors,
  buttonTextContrast,
  darkToneOrNull,
  effectiveButtonColors,
  hexOrNull,
  isButtonStyle,
  lightToneOrNull,
} from '@/lib/bg-tone';
import { formatContrastRatio } from '@/lib/contrast-ratio';
import { useTenantPreview } from '../preview/TenantPreviewProvider';
import { useBrandLook } from './brand-look-context';
import { GradientColorField, type GradientStop } from './GradientColorField';
import { PreviewColorField } from './PreviewColorField';
import type { ButtonKey, PreviewMode } from './preview-colors';

/**
 * A button's colours by the draft's names: the button (a gradient's first colour), a gradient's
 * last colour, and the text.
 */
type Part = 'fill' | 'fillEnd' | 'ink';

const MODES: readonly PreviewMode[] = ['light', 'dark'];

/** Each colour's input id, which is also the summary's key for its row (`BUTTON_KEYS`). */
const FIELD: Record<Part, Record<PreviewMode, ButtonKey>> = {
  fill: { light: 'buttonFillLight', dark: 'buttonFillDark' },
  fillEnd: { light: 'buttonFillEndLight', dark: 'buttonFillEndDark' },
  ink: { light: 'buttonInkLight', dark: 'buttonInkDark' },
};

/**
 * The catalog segment (`brand.buttons.*`) naming each of a gradient's two colours, which its hex
 * input's name (with the mode) and its picker's (`brand.buttons.pick.*`) carry: the field itself
 * is the "Cor do botão", and its first colour the "Cor inicial".
 */
const STOP_NAME: Record<'fill' | 'fillEnd', string> = { fill: 'fillStart', fillEnd: 'fillEnd' };

const SUFFIX: Record<PreviewMode, string> = { light: 'Light', dark: 'Dark' };

/** WCAG 2.x AA for normal text: the buttons' labels are 12 to 16px bold, never large text. */
const AA_TEXT = 4.5;

/**
 * Personalização's "Botões", right after the dark mode's colours: the colour of the app's filled
 * action buttons ("Entrar", "Completar agora", the create buttons) apart from the primary and the
 * secondary, which keep painting everything else (chips, tabs, switches, links, the focus ring).
 * First the style, one for both modes ("Cor sólida" or "Degradê", a `SegmentedControl`); then one
 * column per mode, each with a sample of the button, its "Cor do botão" with the text's, and the
 * contrast of its text. A gradient's "Cor do botão" is ONE field holding both of its colours
 * (`GradientColorField`): its swatch is two halves apart, each painted with one colour, the left
 * half picking the first colour and the right half the last, and its box holds both codes, each
 * named "Cor inicial" or "Cor final" with the mode; the style above already says it is a gradient.
 *
 * Every field opens on the colour the phone paints while it is unset (`effectiveButtonColors`): a
 * solid button is the theme's primary (in dark, the dark mode's own primary or the derived one), a
 * gradient starts there and ends on that colour moved 30% away from its text (`buttonRampEnd`, the
 * reference's ramp of one hue, so an untouched gradient reads as well as the solid button), and
 * the text is the white or navy that reads on the button (on a gradient, on both of its colours),
 * with "Automática" until the tenant picks another one. The dark mode INHERITS each light colour
 * until it gets its own (the reference's gold button is the same in both themes), its text along
 * with its button (with the whole light gradient), and says so ("Igual ao modo claro") only beside
 * the very colour the light mode shows: a dark text of its own on the other side of an inherited
 * first colour turns a gradient's automatic last colour the other way, and that one reads
 * "Automática"; a gradient's field says it only while BOTH of its colours are the light mode's.
 * "Usar a cor automática" goes back, per field (its accessible name says which field and which
 * mode, WCAG 2.5.3): a gradient's one reset clears both of its colours in that mode, and shows
 * while either is the tenant's own. Only a complete hex reaches the draft (`PreviewColorField`,
 * `GradientColorField`); the values are part of the look the wizard's creation and the Marca tab's
 * save keep (`useBrandLook`, either one's). A solid button keeps a gradient's last colours aside,
 * so going back to the gradient brings them back (and the save keeps them aside too).
 *
 * The sample is a piece of that mode's screen: the theme and its ground tone on a box (tokens.css
 * re-tints it by the ids, as it does the phone's screen) with an inert button painted INLINE from
 * the computed colours, the gradient included (`buttonGradient`, the very image the phone's raw key
 * carries), never through a brand scope (`data-brand-scope` belongs to the `BrandPreview` frames,
 * `data-device-screen` to the phone). The pill measures exactly what the phone paints, the text on
 * the button where it reads worst (`buttonTextContrast`: on a gradient, the lower of its two
 * colours), against AA 4.5:1. Not the button against the ground: WCAG 1.4.11 does not ask it of a
 * button with a text label, and the reference's gold reads at 1.75:1 on its ivory on purpose. It
 * only informs, never gates. Focusing or editing a field turns the preview to that field's mode,
 * where its colours show; the style is both modes', so switching it leaves the preview's theme.
 */
export function ButtonColorsCard() {
  const t = useTranslations('platform');
  const tp = useTranslations('profile');
  const { draft, colors, update } = useBrandLook();
  const { setTheme } = useTenantPreview();
  const buttons = draft.buttonColors;
  const style = buttons.style;
  const looks = useMemo(
    () => effectiveButtonColors({ colors, darkColors: draft.darkColors, buttonColors: buttons }),
    [colors, draft.darkColors, buttons],
  );
  const tones = {
    light: lightToneOrNull(draft.lightTone) ?? undefined,
    dark: darkToneOrNull(draft.darkColors.tone) ?? undefined,
  };

  /** Sets the `parts` of `mode` to `hex` (`null`: automatic) and turns the preview to that mode. */
  const set = (mode: PreviewMode, parts: readonly Part[], hex: string | null) => {
    const next: ButtonColors = { ...buttons };
    for (const part of parts) next[part] = { ...buttons[part], [mode]: hex };
    update({ buttonColors: next });
    setTheme(mode);
  };
  const setStyle = (value: string) => {
    if (isButtonStyle(value) && value !== style) {
      update({ buttonColors: { ...buttons, style: value } });
    }
  };

  return (
    <Card data-button-colors data-button-style={style} className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <SectionTitle variant="group">{t('wizard.brand.buttons.title')}</SectionTitle>
        <p className="text-xs text-text-tertiary">{t('wizard.brand.buttons.body')}</p>
      </div>

      <div className="flex flex-col gap-2">
        <SegmentedControl
          className="w-full md:max-w-sm"
          label={t('wizard.brand.buttons.style')}
          options={[
            { value: 'solid', label: t('wizard.brand.buttons.styleSolid') },
            { value: 'gradient', label: t('wizard.brand.buttons.styleGradient') },
          ]}
          value={style}
          onChange={setStyle}
        />
        {style === 'gradient' ? (
          <p className="text-xs text-text-tertiary">{t('wizard.brand.buttons.gradientBody')}</p>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-6 md:grid-cols-2">
        {MODES.map((mode) => {
          const look = looks[mode];
          const ratio = buttonTextContrast(look);
          const ok = ratio >= AA_TEXT;
          const value = formatContrastRatio(ratio, ok);
          const modeName = t(`wizard.brand.buttons.${mode}`);
          // Exactly what the phone's raw keys paint: the first colour, the gradient's image over it.
          const image = style === 'gradient' ? buttonGradient(look.fill, look.fillEnd) : null;
          const quiet = (inherited: boolean) =>
            inherited ? t('wizard.brand.buttons.inherited') : t('wizard.brand.buttons.automatic');
          // One colour, one field: a solid button's, and the text's in either style.
          const colorField = (part: 'fill' | 'ink') => {
            const field = t(`wizard.brand.buttons.${part}`);
            return (
              <PreviewColorField
                key={part}
                id={FIELD[part][mode]}
                label={field}
                pickLabel={t(`wizard.brand.buttons.pick.${part}${SUFFIX[mode]}`)}
                placeholder={t('new.hexPlaceholder')}
                value={hexOrNull(buttons[part][mode])}
                fallback={look[part]}
                onChange={(hex) => set(mode, [part], hex)}
                onReset={() => set(mode, [part], null)}
                resetLabel={t('wizard.brand.buttons.reset')}
                resetName={t('wizard.brand.buttons.resetNamed', { field, mode: modeName })}
                fallbackLabel={quiet(look.from[part] === 'light')}
                onFocus={() => setTheme(mode)}
              />
            );
          };
          // A gradient's colour inside its one field: the hex named for the colour and the mode.
          const stop = (part: 'fill' | 'fillEnd'): GradientStop => ({
            id: FIELD[part][mode],
            name: t('wizard.brand.buttons.hexNamed', {
              field: t(`wizard.brand.buttons.${STOP_NAME[part]}`),
              mode: modeName,
            }),
            pickLabel: t(`wizard.brand.buttons.pick.${STOP_NAME[part]}${SUFFIX[mode]}`),
            value: hexOrNull(buttons[part][mode]),
            fallback: look[part],
            onChange: (hex) => set(mode, [part], hex),
          });
          return (
            <fieldset key={mode} className="min-w-0">
              <legend className="text-sm font-bold text-text">{modeName}</legend>
              <div className="mt-3 flex flex-col gap-3">
                {/* That mode's ground, as the phone paints it, with the button on it. */}
                <div
                  data-button-sample={mode}
                  data-theme={mode}
                  data-bg-tone={mode === 'light' ? tones.light : undefined}
                  data-dark-tone={mode === 'dark' ? tones.dark : undefined}
                  className="flex min-h-20 items-center justify-center rounded-xl border border-border bg-bg p-4"
                >
                  <div inert aria-hidden="true">
                    <Button
                      variant="brand"
                      type="button"
                      tabIndex={-1}
                      style={{
                        backgroundColor: look.fill,
                        backgroundImage: image ?? 'none',
                        color: look.ink,
                      }}
                    >
                      {tp('nudge.action')}
                    </Button>
                  </div>
                </div>
                {style === 'gradient' ? (
                  <GradientColorField
                    label={t('wizard.brand.buttons.fill')}
                    placeholder={t('new.hexPlaceholder')}
                    start={stop('fill')}
                    end={stop('fillEnd')}
                    onReset={() => set(mode, ['fill', 'fillEnd'], null)}
                    resetLabel={t('wizard.brand.buttons.reset')}
                    resetName={t('wizard.brand.buttons.resetNamed', {
                      field: t('wizard.brand.buttons.fill'),
                      mode: modeName,
                    })}
                    fallbackLabel={quiet(
                      look.from.fill === 'light' && look.from.fillEnd === 'light',
                    )}
                    onFocus={() => setTheme(mode)}
                  />
                ) : (
                  colorField('fill')
                )}
                {colorField('ink')}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="text-sm text-text-secondary">
                    {t('wizard.brand.buttons.contrast')}
                  </span>
                  <StatusPill tone={ok ? 'success' : 'warning'} data-button-contrast={mode}>
                    {ok
                      ? t('new.contrast.ok', { ratio: value })
                      : t('new.contrast.low', { ratio: value })}
                  </StatusPill>
                </div>
              </div>
            </fieldset>
          );
        })}
      </div>
    </Card>
  );
}
