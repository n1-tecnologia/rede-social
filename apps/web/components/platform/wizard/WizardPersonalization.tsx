'use client';

import {
  contrastRatio,
  contrastReport,
  deriveBrandColors,
  hexColorSchema,
} from '@rede-social/contracts/branding';
import { BrandPreview } from '@rede-social/core/ui';
import { Button, Card, SectionTitle, StatusPill, Switch } from '@rede-social/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useMemo } from 'react';
import { LinkButton } from '@/app/(auth)/LinkButton';
import type { DraftField } from '@/app/(platform)/plataforma/novo/actions';
import { resolveButtonPairs } from '@/lib/bg-tone';
import { formatContrastRatio } from '@/lib/contrast-ratio';
import { ColorField } from '../ColorField';
import { ContrastFeedback, hasLowContrast } from '../ContrastFeedback';
import { useTenantPreview } from '../preview/TenantPreviewProvider';
import { BackgroundTonePicker } from './BackgroundTonePicker';
import { ButtonColorsCard } from './ButtonColorsCard';
import { DarkColorsCard } from './DarkColorsCard';
import { useThemeSurfaces } from './preview-colors';
import { useTenantDraft } from './TenantDraftProvider';
import { TitleFontPicker } from './TitleFontPicker';
import { WizardBrandPicker } from './WizardBrandPicker';

/** WCAG 2.x AA for a UI component: the contracts' floor for the primary on a surface. */
const AA_UI = 3;

/**
 * Step 2 (Personalização) before the tenant exists: how the app looks and what it offers, in the
 * summary's order. The two source colours with live swatches and the contrast readout
 * (`contrastReport` over `deriveBrandColors`, computed in the browser from the last VALID hexes),
 * then the light theme's ground (`BackgroundTonePicker`, eight fixed tones); the dark theme's own
 * primary, secondary and ground (`DarkColorsCard`); the filled buttons' own colours per theme,
 * solid or a gradient (`ButtonColorsCard`); the titles' font with the titles' and the app name's
 * inks per theme (`TitleFontPicker`); the logo and square icon (`WizardBrandPicker`, picked, not
 * uploaded) and the module switches (all on by default, D-17). Below `xl` the kernel
 * `BrandPreview` mini-shells preview the two source colours with the light ground tone, the dark
 * mode's colours and tone, and each theme's buttons (the last VALID ones, `previewColors`, as the
 * phone shows them; the buttons resolved by `resolveButtonPairs`, the dark one inheriting the
 * light one, a gradient whole); from `xl` up
 * the wizard's phone shows everything, beside the form, and turns to the theme being edited (a
 * light field or tone: light; the dark card: dark; a button field: its mode). Every change lives in
 * the draft; NOTHING is sent to the API here. The summary's confirmation sends it all: the pair,
 * the modules and the files, and the look (the grounds, the dark colours, the buttons, the font and
 * the inks, `lookBodyOf`); the same cards edit that look later, on the tenant page's Marca tab.
 *
 * Two contrast readouts, on purpose. `ContrastFeedback` measures the PAIR exactly as the API's
 * colours route does (the pair on the default gray and grafite grounds) and gates the step. The rest
 * of the look is measured where it is chosen and never gates, as the look's own route never does:
 * under the light tone, the primary against that tone's ground (`useThemeSurfaces`, tokens.css's own
 * value; a toned ground costs a primary about 6% of its contrast, so a primary at 3.1:1 on the gray
 * can fall under 3:1 on a tone), the dark mode's own primary and tone in their card, and the
 * buttons' text on their own colours in theirs. While any of those is set (a button colour or the
 * gradient included: the "text on the primary" pill then no longer describes the phone's action
 * buttons), a line under the pills says which colours they measure, so the two readouts never read
 * as contradicting.
 *
 * "Continuar" checks the two hexes with the API's own schema (`hexColorSchema`, in the browser) and
 * opens Domínio. Its ONLY gate is the "Salvar mesmo assim" acknowledgement when a contrast check
 * fails; the later steps stay closed while the colours do not pass (the draft's `brandReady`). The
 * look's other colours never gate it.
 */
export function WizardPersonalization() {
  const t = useTranslations('platform');
  const tb = useTranslations('platformBranding');
  const router = useRouter();
  const { draft, colors, previewColors, moduleKeys, logo, logoDark, restored, update } =
    useTenantDraft();
  const { setTheme } = useTenantPreview();
  const lightGround = useThemeSurfaces('light', draft.lightTone).ground;

  const report = useMemo(() => contrastReport(deriveBrandColors(colors)), [colors]);
  const lowContrast = hasLowContrast(report);
  // The primary on the chosen light tone, as the phone paints it (it informs, never a gate).
  const toneRatio = contrastRatio(colors.primary, lightGround);
  const dark = previewColors.darkColors;
  // Each theme's buttons as the phone gets them (the dark one inheriting the light one; a gradient
  // whole, its automatic first colour the primary, in dark the dark mode's own or the derived one,
  // and its last colour that one's ramp, never the secondary).
  const buttons = resolveButtonPairs({
    buttonColors: previewColors.buttonColors,
    colors,
    darkColors: dark,
  });
  const lookMeasuredApart = Boolean(
    draft.lightTone || dark.primary || dark.tone || buttons.light || buttons.dark,
  );

  /** A colour edit clears that field's error (a refused creation may have set it). */
  const editColor = (field: Extract<DraftField, 'primary' | 'secondary'>, hex: string) => {
    const fieldErrors = { ...draft.fieldErrors };
    delete fieldErrors[field];
    update({ [field]: hex, fieldErrors });
  };

  const fieldError = (name: DraftField) => {
    const key = draft.fieldErrors[name];
    return key ? t(`new.errors.${key}`) : undefined;
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fieldErrors = { ...draft.fieldErrors };
    for (const field of ['primary', 'secondary'] as const) {
      if (hexColorSchema.safeParse(draft[field]).success) delete fieldErrors[field];
      else fieldErrors[field] = 'hexInvalid';
    }
    update({ fieldErrors });
    if (fieldErrors.primary || fieldErrors.secondary) return;
    router.push('/plataforma/novo/dominio');
  };

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      data-draft-ready={restored ? '' : undefined}
      className="flex flex-col gap-6"
    >
      <Card className="flex flex-col gap-3 p-4 md:p-6">
        <SectionTitle variant="group">{t('new.colors')}</SectionTitle>
        {/* The light theme is where these two colours show as typed: a focus here turns the
            preview light (the dark one derives its own, or takes the dark card's). */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: it only hears the focus bubbling from the two fields' native controls; the grid adds no interaction. */}
        <div className="grid gap-3 md:grid-cols-2" onFocus={() => setTheme('light')}>
          <ColorField
            id="primary"
            name="primary"
            label={t('new.primary')}
            value={draft.primary}
            onChange={(hex) => editColor('primary', hex)}
            error={fieldError('primary')}
            pickLabel={t('new.pickColor')}
            placeholder={t('new.hexPlaceholder')}
          />
          <ColorField
            id="secondary"
            name="secondary"
            label={t('new.secondary')}
            value={draft.secondary}
            onChange={(hex) => editColor('secondary', hex)}
            error={fieldError('secondary')}
            pickLabel={t('new.pickColor')}
            placeholder={t('new.hexPlaceholder')}
          />
        </div>
        <BrandPreview
          className="xl:hidden"
          colors={colors}
          displayName={draft.displayName.trim() || tb('preview.namePlaceholder')}
          logoUrl={logo?.url ?? null}
          logoDarkUrl={logoDark?.url ?? null}
          lightTone={draft.lightTone}
          dark={dark}
          buttons={buttons}
          labels={{
            light: tb('preview.light'),
            dark: tb('preview.dark'),
            lightAria: tb('preview.lightAria'),
            darkAria: tb('preview.darkAria'),
            login: tb('preview.login'),
          }}
        />
        <ContrastFeedback
          report={report}
          confirmed={draft.contrastConfirmed}
          onConfirmedChange={(contrastConfirmed) => update({ contrastConfirmed })}
        />
        {lookMeasuredApart ? (
          <p data-contrast-saved className="text-xs text-text-tertiary">
            {t('wizard.brand.contrastSaved')}
          </p>
        ) : null}
        <div className="flex flex-col gap-3 border-t border-divider pt-4">
          <BackgroundTonePicker mode="light" />
          {draft.lightTone ? (
            <div
              data-tone-contrast
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
            >
              <span className="text-sm text-text-secondary">
                {t('wizard.brand.background.primaryContrast')}
              </span>
              <StatusPill tone={toneRatio >= AA_UI ? 'success' : 'warning'}>
                {toneRatio >= AA_UI
                  ? t('new.contrast.ok', { ratio: formatContrastRatio(toneRatio, true) })
                  : t('new.contrast.low', { ratio: formatContrastRatio(toneRatio, false) })}
              </StatusPill>
            </div>
          ) : null}
        </div>
      </Card>

      <DarkColorsCard />

      <ButtonColorsCard />

      <TitleFontPicker />

      <WizardBrandPicker />

      <Card className="flex flex-col gap-3 p-4 md:p-6">
        <SectionTitle variant="group">{t('new.modules')}</SectionTitle>
        <ul className="rounded-xl border border-border">
          {moduleKeys.map((key) => (
            <li
              key={key}
              className="flex min-h-14 items-center gap-3 border-b border-divider px-4 py-2 last:border-0"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-bold text-text">{t(`moduleNames.${key}`)}</span>
                <span className="text-xs text-text-tertiary">{t(`moduleDescriptions.${key}`)}</span>
              </div>
              <Switch
                checked={draft.modules[key] ?? true}
                onChange={(checked) => update({ modules: { ...draft.modules, [key]: checked } })}
                label={t(`moduleNames.${key}`)}
              />
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between">
        <LinkButton href="/plataforma/novo" variant="ghost">
          {t('wizard.actions.back')}
        </LinkButton>
        <Button
          type="submit"
          variant="brand"
          size="lg"
          disabled={lowContrast && !draft.contrastConfirmed}
          className="w-full md:w-auto"
        >
          {t('wizard.actions.next')}
        </Button>
      </div>
    </form>
  );
}
