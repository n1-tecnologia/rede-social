'use client';

import { contrastRatio } from '@rede-social/contracts/branding';
import { Button, Card, SectionTitle, StatusPill, useToast } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
} from 'react';
import type { saveBrandLookAction } from '@/app/(platform)/plataforma/tenants/[id]/marca/actions';
import {
  type LookFields,
  lookBodyOf,
  lookFieldsOf,
  sameLook,
  settleButtonColors,
  settleDarkColors,
  settleFontColors,
} from '@/lib/bg-tone';
import type { BrandingView } from '@/lib/branding-view';
import { formatContrastRatio } from '@/lib/contrast-ratio';
import { BackgroundTonePicker } from './wizard/BackgroundTonePicker';
import { ButtonColorsCard } from './wizard/ButtonColorsCard';
import {
  BrandLookContext,
  type BrandLookValue,
  type PreviewColors,
} from './wizard/brand-look-context';
import { DarkColorsCard } from './wizard/DarkColorsCard';
import { useThemeSurfaces } from './wizard/preview-colors';
import { TitleFontPicker } from './wizard/TitleFontPicker';

/** WCAG 2.x AA for a UI component: the contracts' floor for the primary on a surface. */
const AA_UI = 3;

/** The save half of the look editor: what `BrandLookForm`'s last card needs. */
type LookSave = {
  /** The fields differ from the saved look (as the route would store them, `sameLook`). */
  dirty: boolean;
  pending: boolean;
  save: () => void;
  /** Back to the saved look. */
  discard: () => void;
};

const LookSaveContext = createContext<LookSave | null>(null);

function previewOf(fields: LookFields): PreviewColors {
  return {
    darkColors: fields.darkColors,
    fontColors: fields.fontColors,
    buttonColors: fields.buttonColors,
  };
}

export interface BrandLookProviderProps {
  tenantId: string;
  /** The server-rendered view; the page keys this provider on its saved look (`brandLookKey`). */
  view: BrandingView;
  save: typeof saveBrandLookAction;
  children: ReactNode;
}

/**
 * The Marca tab's look beyond the pair (2026-10-03): the grounds, the dark mode's own colours, the
 * buttons, the title font and the inks, edited with the very cards of the new-tenant wizard
 * (`BrandLookForm`) and saved whole by `saveBrandLookAction` (`PUT …/branding/look`).
 *
 * It holds the look being edited in the shape the cards read (`BrandLookContext`, the same value
 * the wizard's draft provides): the fields as the owner sets them, the last valid colours the
 * previews show (`settle*`, exactly as the draft does), the PERSISTED pair the automatic colours
 * derive from, the tenant's name and logo for the samples. It wraps the whole tab, so the colours
 * card's `BrandPreview` shows the look as it is being edited too (`useOptionalBrandLook`).
 *
 * The page keys it on the SAVED look alone: a save (the route answers the fresh view and the tab is
 * revalidated) remounts it on what was stored, while a pair save or an upload re-renders it with the
 * new pair and keeps the look being edited. Nothing is sent until "Salvar aparência".
 */
export function BrandLookProvider({ tenantId, view, save, children }: BrandLookProviderProps) {
  const t = useTranslations('platformBranding');
  const toast = useToast();
  const [baseline, setBaseline] = useState<LookFields>(() => lookFieldsOf(view.look));
  const [fields, setFields] = useState<LookFields>(baseline);
  const [previewColors, setPreviewColors] = useState<PreviewColors>(() => previewOf(baseline));
  const [pending, startTransition] = useTransition();

  const update = useCallback((patch: Partial<LookFields>) => {
    setFields((prev) => ({ ...prev, ...patch }));
    const { darkColors, fontColors, buttonColors } = patch;
    if (darkColors === undefined && fontColors === undefined && buttonColors === undefined) return;
    setPreviewColors((prev) => {
      const next = {
        darkColors: darkColors ? settleDarkColors(darkColors, prev.darkColors) : prev.darkColors,
        fontColors: fontColors ? settleFontColors(fontColors, prev.fontColors) : prev.fontColors,
        buttonColors: buttonColors
          ? settleButtonColors(buttonColors, prev.buttonColors)
          : prev.buttonColors,
      };
      return next.darkColors === prev.darkColors &&
        next.fontColors === prev.fontColors &&
        next.buttonColors === prev.buttonColors
        ? prev
        : next;
    });
  }, []);

  const dirty = !sameLook(fields, baseline);

  const saveLook = useCallback(() => {
    startTransition(async () => {
      const result = await save(tenantId, lookBodyOf(fields));
      if (result.ok) {
        setBaseline(lookFieldsOf(result.view.look));
        toast.show({ tone: 'success', message: t('toasts.saved') });
      } else {
        toast.show({
          tone: 'error',
          message: result.code === 'invalid' ? t('look.errors.invalid') : t('toasts.error'),
        });
      }
    });
  }, [save, tenantId, fields, toast, t]);

  const discard = useCallback(() => {
    setFields(baseline);
    setPreviewColors(previewOf(baseline));
  }, [baseline]);

  const { displayName, logoUrl } = view;
  const { primary, secondary } = view.colors;
  const value = useMemo<BrandLookValue>(
    () => ({
      draft: { ...fields, displayName },
      colors: { primary, secondary },
      previewColors,
      logo: logoUrl ? { url: logoUrl } : null,
      update,
    }),
    [fields, displayName, primary, secondary, previewColors, logoUrl, update],
  );
  const lookSave = useMemo<LookSave>(
    () => ({ dirty, pending, save: saveLook, discard }),
    [dirty, pending, saveLook, discard],
  );

  return (
    <BrandLookContext.Provider value={value}>
      <LookSaveContext.Provider value={lookSave}>{children}</LookSaveContext.Provider>
    </BrandLookContext.Provider>
  );
}

/**
 * The look's cards on the Marca tab, in the wizard's order: the light ground (in a card of its own
 * here, since the pair's card has its own save), the dark mode's colours with its ground, the
 * buttons, and the title font with the inks; then ONE save for the whole look ("Salvar aparência",
 * apart from the pair's "Salvar alterações"), enabled only while the look differs from the saved one,
 * with the way back to it. The cards turn the tab's preview theme (`TenantPreviewProvider`) as in
 * the wizard, which the title font's sample follows; their contrast readouts only inform, as the
 * look's route gates on nothing. Must sit inside `BrandLookProvider`.
 */
export function BrandLookForm() {
  const t = useTranslations('platformBranding');
  const tw = useTranslations('platform');
  const lookSave = useContext(LookSaveContext);
  const look = useContext(BrandLookContext);
  const lightTone = look?.draft.lightTone ?? null;
  const ground = useThemeSurfaces('light', lightTone).ground;
  if (!lookSave || !look) return null;
  const toneRatio = contrastRatio(look.colors.primary, ground);
  const { dirty, pending, save, discard } = lookSave;

  return (
    <div data-brand-look className="flex flex-col gap-6">
      <Card data-light-tone className="flex flex-col gap-3 p-4 md:p-6">
        <SectionTitle variant="group">{t('look.lightTitle')}</SectionTitle>
        <BackgroundTonePicker mode="light" />
        {lightTone ? (
          <div
            data-tone-contrast
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
          >
            <span className="text-sm text-text-secondary">
              {tw('wizard.brand.background.primaryContrast')}
            </span>
            <StatusPill tone={toneRatio >= AA_UI ? 'success' : 'warning'}>
              {toneRatio >= AA_UI
                ? tw('new.contrast.ok', { ratio: formatContrastRatio(toneRatio, true) })
                : tw('new.contrast.low', { ratio: formatContrastRatio(toneRatio, false) })}
            </StatusPill>
          </div>
        ) : null}
      </Card>

      <DarkColorsCard />

      <ButtonColorsCard />

      <TitleFontPicker />

      <Card
        data-brand-look-save
        className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6"
      >
        <p className="text-sm text-text-secondary" aria-live="polite">
          {dirty ? t('look.unsaved') : t('look.hint')}
        </p>
        <div className="flex flex-col-reverse gap-3 md:flex-row">
          {dirty ? (
            <Button type="button" variant="ghost" disabled={pending} onClick={discard}>
              {t('look.discard')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="brand"
            size="lg"
            loading={pending}
            disabled={!dirty || pending}
            aria-busy={pending || undefined}
            onClick={save}
            className="w-full md:w-auto"
          >
            {pending ? t('colors.saving') : t('look.save')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
