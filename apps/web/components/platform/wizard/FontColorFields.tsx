'use client';

import { contrastRatio } from '@rede-social/contracts/branding';
import { StatusPill } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { darkToneOrNull, type FontColors, hexOrNull, lightToneOrNull } from '@/lib/bg-tone';
import { formatContrastRatio } from '@/lib/contrast-ratio';
import { useTitleFont } from '@/lib/title-font';
import { useTenantPreview } from '../preview/TenantPreviewProvider';
import { useBrandLook } from './brand-look-context';
import { FontSampleLine } from './FontSampleLine';
import { PreviewColorField } from './PreviewColorField';
import {
  DEFAULT_TEXT_COLORS,
  type PreviewMode,
  type ThemeSurfaces,
  useThemeSurfaces,
} from './preview-colors';

type Target = keyof FontColors;

const TARGETS: readonly Target[] = ['title', 'appName'];
const MODES: readonly PreviewMode[] = ['light', 'dark'];

/**
 * WCAG 2.x AA: large text (24px, or 18.66px bold) needs 3:1, any smaller text 4.5:1. A bold 16px
 * name is NOT large text, so it is held to 4.5:1 like body copy.
 */
const AA_LARGE = 3;
const AA_TEXT = 4.5;

type Check = { ratio: number; min: number };

/**
 * Every place an ink is drawn, against what lies under it there, each with its own floor. The
 * titles' ink reaches the Comunidades and Eventos titles (24px bold, large: 3:1) on the screen's
 * ground AND the 16px bold names drawn on a card (Início's next event: 4.5:1) on the raised
 * surface; a name over a photo stays white (globals.css) and is not measured. The app name is
 * 16px bold on the top bar, the raised surface too (4.5:1).
 */
function checksOf(target: Target, ink: string, { ground, surface }: ThemeSurfaces): Check[] {
  const onCards: Check = { ratio: contrastRatio(ink, surface), min: AA_TEXT };
  return target === 'title'
    ? [{ ratio: contrastRatio(ink, ground), min: AA_LARGE }, onCards]
    : [onCards];
}

/**
 * The check with the least room over its own floor: the one the pill shows, so it fails exactly
 * when one place fails, and reads the ratio of that place.
 */
function tightest(checks: readonly Check[]): Check {
  return checks.reduce((worst, check) =>
    check.ratio / check.min < worst.ratio / worst.min ? check : worst,
  );
}

/** The catalog segment of each ink (`brand.font.colors.*`); the field ids keep the draft's names. */
const KEY: Record<Target, string> = { title: 'titles', appName: 'appName' };

/**
 * The inks of the title font, inside its card after the font's line and its editor: the titles'
 * colour and the app name's colour in the top bar (the name shows only without a logo), each with
 * ONE value per theme, because an ink that reads on the light ground rarely reads on the dark one.
 * Every field opens on the theme's own text colour (`DEFAULT_TEXT_COLORS`, the tokens'
 * `--theme-text`) with "Padrão" beside it until the tenant picks another one ("Usar a cor padrão"
 * goes back); the light and the dark value are stored apart
 * (`fontColors.{title,appName}.{light,dark}`), so editing one never moves the other.
 *
 * Right above the fields, in their two columns, one sample per theme (`ModeSample`): where the
 * card's own sample shows the inks of the theme the preview shows, these show both themes at once,
 * each over its own fields, drawn in the same lines (`FontSampleLine`).
 *
 * Each value carries its contrast, measured in the browser with the contracts' `contrastRatio`
 * against what that ink sits on in that theme, as tokens.css resolves it for the chosen tone
 * (`useThemeSurfaces`), at the floor of the text drawn there (`checksOf`): a title colour against
 * the ground for the large titles (3:1) AND against the cards for the 16px names (4.5:1), the app
 * name against the top bar (4.5:1). The pill shows the place with the least room (`tightest`). It
 * only informs, never gates. Focusing or editing a "Modo escuro" field turns the preview device
 * dark, a "Modo claro" one light, where the ink shows. The inks are part of the look the wizard's
 * creation and the Marca tab's save keep (`useBrandLook`, either one's).
 */
export function FontColorFields() {
  const t = useTranslations('platform');
  const tb = useTranslations('platformBranding');
  const { draft, update, logo } = useBrandLook();
  const { setTheme } = useTenantPreview();
  const stack = useTitleFont(draft.titleFont);
  const lightSurfaces = useThemeSurfaces('light', draft.lightTone);
  const darkSurfaces = useThemeSurfaces('dark', draft.darkColors.tone);
  const surfaces = { light: lightSurfaces, dark: darkSurfaces };
  const inks = draft.fontColors;
  const tones = {
    light: lightToneOrNull(draft.lightTone),
    dark: darkToneOrNull(draft.darkColors.tone),
  };
  // The top bar's name, which the app draws only without a logo.
  const appName = logo ? null : draft.displayName.trim() || tb('preview.namePlaceholder');

  const set = (target: Target, mode: PreviewMode, hex: string | null) => {
    update({ fontColors: { ...inks, [target]: { ...inks[target], [mode]: hex } } });
    setTheme(mode);
  };

  return (
    <div data-font-colors className="flex flex-col gap-4">
      {/* The fields' own columns (`md:grid-cols-2`, the same gap): light, then dark. */}
      <div data-font-color-samples className="grid gap-3 md:grid-cols-2">
        {MODES.map((mode) => (
          <ModeSample
            key={mode}
            mode={mode}
            tone={tones[mode]}
            stack={stack}
            appName={appName}
            inks={{ title: hexOrNull(inks.title[mode]), appName: hexOrNull(inks.appName[mode]) }}
          />
        ))}
      </div>
      {TARGETS.map((target) => (
        <fieldset key={target} data-font-color={target} className="min-w-0">
          <legend className="text-sm font-bold text-text">
            {t(`wizard.brand.font.colors.${KEY[target]}`)}
          </legend>
          <p className="mt-1 text-xs text-text-tertiary">
            {t(`wizard.brand.font.colors.${KEY[target]}Body`)}
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {MODES.map((mode) => {
              const stored = hexOrNull(inks[target][mode]);
              const ink = stored ?? DEFAULT_TEXT_COLORS[mode];
              const { ratio, min } = tightest(checksOf(target, ink, surfaces[mode]));
              const ok = ratio >= min;
              const value = formatContrastRatio(ratio, ok);
              const suffix = mode === 'light' ? 'Light' : 'Dark';
              return (
                <PreviewColorField
                  key={mode}
                  id={`${target}Color${suffix}`}
                  label={t(`wizard.brand.font.colors.${mode}`)}
                  pickLabel={t(`wizard.brand.font.colors.pick.${KEY[target]}${suffix}`)}
                  placeholder={t('new.hexPlaceholder')}
                  value={stored}
                  fallback={DEFAULT_TEXT_COLORS[mode]}
                  onChange={(hex) => set(target, mode, hex)}
                  onReset={() => set(target, mode, null)}
                  resetLabel={t('wizard.brand.font.colors.reset')}
                  resetName={t('wizard.brand.font.colors.resetNamed', {
                    field: t(`wizard.brand.font.colors.${KEY[target]}`),
                    mode: t(`wizard.brand.font.colors.${mode}`),
                  })}
                  fallbackLabel={t('wizard.brand.font.colors.default')}
                  onFocus={() => setTheme(mode)}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-text-tertiary">
                      {t('wizard.brand.font.colors.contrast')}
                    </span>
                    <StatusPill
                      tone={ok ? 'success' : 'warning'}
                      data-font-contrast={`${target}-${mode}`}
                    >
                      {ok
                        ? t('new.contrast.ok', { ratio: value })
                        : t('new.contrast.low', { ratio: value })}
                    </StatusPill>
                  </span>
                </PreviewColorField>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

/**
 * One theme's sample, over that theme's fields: a piece of the tenant's screen in `mode` as the
 * phone paints it, the theme and its ground tone on the box (tokens.css re-tints it by the id, as
 * it does the phone's screen; the default tone is never carried), never through a brand scope
 * (`data-brand-scope` belongs to the `BrandPreview` frames, `data-device-screen` to the phone).
 * On it, in the title font, lines of the card's own sample: the app name in that theme's app-name
 * ink (only without a logo, as in the top bar), and a list's title and an event card's name in
 * that theme's titles' ink. An ink left unset is the theme's own text colour, which the box's
 * theme resolves, exactly as on the phone. The inks are the draft's, the values the fields hold:
 * only a complete hex reaches the draft (`PreviewColorField`), so a sample changes when a hex is
 * complete, never on a half-typed one, like the phone.
 */
function ModeSample({
  mode,
  tone,
  stack,
  appName,
  inks,
}: {
  mode: PreviewMode;
  /** That theme's ground tone; `null` for the default. */
  tone: string | null;
  /** The title font's CSS stack (`useTitleFont`); `null` keeps Manrope. */
  stack: string | null;
  /** The top bar's name; `null` when a logo stands in its place. */
  appName: string | null;
  /** That theme's inks, valid hexes, `null` for the theme's own text colour. */
  inks: { title: string | null; appName: string | null };
}) {
  const t = useTranslations();
  return (
    <div
      data-font-color-sample={mode}
      data-theme={mode}
      data-bg-tone={mode === 'light' ? (tone ?? undefined) : undefined}
      data-dark-tone={mode === 'dark' ? (tone ?? undefined) : undefined}
      className="flex min-w-0 flex-col gap-4 rounded-xl bg-bg p-4 text-text"
    >
      <p className="text-xs font-bold uppercase tracking-wider text-text-tertiary">
        {mode === 'dark'
          ? t('platform.wizard.brand.font.sampleDark')
          : t('platform.wizard.brand.font.sampleLight')}
      </p>
      <div className="flex min-w-0 flex-col gap-2">
        {appName === null ? null : (
          <FontSampleLine
            data-font-color-sample-app-name
            kind="appName"
            stack={stack}
            ink={inks.appName}
          >
            {appName}
          </FontSampleLine>
        )}
        <FontSampleLine data-font-color-sample-title kind="title" stack={stack} ink={inks.title}>
          {t('communities.list.title')}
        </FontSampleLine>
        <FontSampleLine
          data-font-color-sample-title
          kind="eventName"
          stack={stack}
          ink={inks.title}
        >
          {t('platform.devicePreview.sample.eventTitle')}
        </FontSampleLine>
      </div>
    </div>
  );
}
