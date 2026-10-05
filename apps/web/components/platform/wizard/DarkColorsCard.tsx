'use client';

import { contrastRatio, deriveBrandColors } from '@rede-social/contracts/branding';
import { Card, SectionTitle, StatusPill } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { type DarkColors, hexOrNull } from '@/lib/bg-tone';
import { formatContrastRatio } from '@/lib/contrast-ratio';
import { useTenantPreview } from '../preview/TenantPreviewProvider';
import { BackgroundTonePicker } from './BackgroundTonePicker';
import { useBrandLook } from './brand-look-context';
import { PreviewColorField } from './PreviewColorField';
import { useThemeSurfaces } from './preview-colors';

/** WCAG 2.x AA, the same floors as the contracts' report: normal text, and a UI component. */
const AA_TEXT = 4.5;
const AA_UI = 3;

/**
 * Personalização's "Cores do modo escuro": the colours the app takes ONLY in the dark theme, right
 * after the Cores card. Without them the dark theme keeps deriving from the light pair, as the
 * contracts do (`deriveBrandColors`: the primary mixed 30% towards white, the secondary as is), and
 * each field opens on exactly that derived colour, with "Automática" until the tenant picks another
 * one ("Usar a cor automática" goes back). The dark ground is the dark `BackgroundTonePicker`.
 *
 * The contrast readout is the dark twin of the Cores card's, measured in the browser with the
 * contracts' own `contrastRatio`: the text on the dark primary (the ink the preview puts on it, the
 * white or navy `deriveBrandColors` picks, AA 4.5:1) and the dark primary on the chosen dark ground
 * (read from tokens.css by `useThemeSurfaces`, 3:1). It only informs, never gates: neither the
 * wizard's "Continuar" (the draft's `brandReady` ignores it) nor a save (the look's route has no
 * contrast gate; the pair keeps its own).
 *
 * Any interaction here (the focus entering the card, a colour, a tone, a reset) turns the preview
 * device dark, the only theme these colours show in. The colours are part of the look the wizard's
 * creation and the Marca tab's save keep (`useBrandLook`, either one's).
 */
export function DarkColorsCard() {
  const t = useTranslations('platform');
  const { draft, colors, update } = useBrandLook();
  const { setTheme } = useTenantPreview();
  const dark = draft.darkColors;
  const { ground } = useThemeSurfaces('dark', dark.tone);

  const derived = useMemo(() => deriveBrandColors(colors), [colors]);
  // Only a valid hex counts as stored: the derivations below throw on anything else.
  const storedPrimary = hexOrNull(dark.primary);
  const storedSecondary = hexOrNull(dark.secondary);
  const primary = storedPrimary ?? derived.primaryDark;
  // The ink the dark theme puts on its primary: the contracts' white-or-navy pick for that colour.
  const onPrimary = deriveBrandColors({ primary, secondary: colors.secondary }).onPrimary;
  const checks = [
    { key: 'contrastOnPrimary', ratio: contrastRatio(primary, onPrimary), min: AA_TEXT },
    { key: 'contrastSurface', ratio: contrastRatio(primary, ground), min: AA_UI },
  ] as const;

  const toDark = () => setTheme('dark');
  const set = (patch: Partial<DarkColors>) => {
    update({ darkColors: { ...dark, ...patch } });
    toDark();
  };

  return (
    <Card data-dark-colors className="flex flex-col gap-4 p-4 md:p-6" onFocus={toDark}>
      <div className="flex flex-col gap-1">
        <SectionTitle variant="group">{t('wizard.brand.dark.title')}</SectionTitle>
        <p className="text-xs text-text-tertiary">{t('wizard.brand.dark.body')}</p>
      </div>

      {/* A group of its own: the two fields share their labels with the Cores card's pair. */}
      <fieldset className="grid min-w-0 gap-3 md:grid-cols-2">
        <legend className="sr-only">{t('wizard.brand.dark.title')}</legend>
        <PreviewColorField
          id="darkPrimary"
          label={t('new.primary')}
          pickLabel={t('wizard.brand.dark.primaryPick')}
          placeholder={t('new.hexPlaceholder')}
          value={storedPrimary}
          fallback={derived.primaryDark}
          onChange={(hex) => set({ primary: hex })}
          onReset={() => set({ primary: null })}
          resetLabel={t('wizard.brand.dark.reset')}
          resetName={t('wizard.brand.dark.resetNamed', { field: t('new.primary') })}
          fallbackLabel={t('wizard.brand.dark.automatic')}
        />
        <PreviewColorField
          id="darkSecondary"
          label={t('new.secondary')}
          pickLabel={t('wizard.brand.dark.secondaryPick')}
          placeholder={t('new.hexPlaceholder')}
          value={storedSecondary}
          fallback={colors.secondary}
          onChange={(hex) => set({ secondary: hex })}
          onReset={() => set({ secondary: null })}
          resetLabel={t('wizard.brand.dark.reset')}
          resetName={t('wizard.brand.dark.resetNamed', { field: t('new.secondary') })}
          fallbackLabel={t('wizard.brand.dark.automatic')}
        />
      </fieldset>

      <BackgroundTonePicker mode="dark" />

      <div data-dark-contrast className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-text-tertiary">
          {t('wizard.brand.dark.contrastTitle')}
        </span>
        <ul className="flex flex-col gap-2">
          {checks.map(({ key, ratio, min }) => {
            const ok = ratio >= min;
            const value = formatContrastRatio(ratio, ok);
            return (
              <li key={key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="text-sm text-text-secondary">{t(`wizard.brand.dark.${key}`)}</span>
                <StatusPill tone={ok ? 'success' : 'warning'} data-dark-contrast-check={key}>
                  {ok
                    ? t('new.contrast.ok', { ratio: value })
                    : t('new.contrast.low', { ratio: value })}
                </StatusPill>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
