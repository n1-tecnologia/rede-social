'use client';

import {
  type ContrastReport,
  contrastPasses,
  contrastReport,
  deriveBrandColors,
  hexColorSchema,
} from '@tria/contracts/branding';
import { BrandPreview, type BrandPreviewLabels } from '@tria/core/ui';
import { Button, Card, SectionTitle, useToast } from '@tria/ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import type {
  getBrandingStatusAction,
  saveBrandColorsAction,
} from '@/app/(platform)/plataforma/tenants/[id]/marca/actions';
import type { BrandingView } from '@/lib/branding-view';
import { ColorField } from './ColorField';
import { ContrastFeedback } from './ContrastFeedback';

/** The server actions the form calls (02-14 Task 1: colours + status; Task 2 adds the uploads). */
export type BrandingActions = {
  saveColors: typeof saveBrandColorsAction;
  status: typeof getBrandingStatusAction;
};

export interface BrandingFormProps {
  tenantId: string;
  /** The server-rendered view; the page remounts the form (`key`) whenever it changes. */
  view: BrandingView;
  /** Strings of the kernel `BrandPreview` (props, never a hook — Phase 8 reuses it as-is). */
  previewLabels: BrandPreviewLabels;
  actions: BrandingActions;
}

/**
 * Marca tab orchestrator (02-14, mockup `tenant-page-marca`, UI-SPEC E12/E14). Cores card: the two
 * `ColorField`s (02-12), the kernel `BrandPreview` following the LAST VALID pair, the both-modes
 * `ContrastFeedback` and "Salvar alterações" — disabled until a colour differs from the persisted
 * one, both hexes are valid and, when any contrast check fails, "Salvar mesmo assim" is ticked.
 *
 * The `confirmLowContrast` flag is sent ONLY when the browser-side report already failed and the
 * user ticked the box; the API's 400 `{ confirmLowContrast: 'required', contrastReport }` is the
 * fallback line — its report replaces the local one and re-arms the checkbox, never an automatic
 * retry (D-41). Strings come from `platformBranding` / `platform` (`useTranslations`, the 02-12
 * client-component pattern).
 */
export function BrandingForm({
  tenantId,
  view: initialView,
  previewLabels,
  actions,
}: BrandingFormProps) {
  const t = useTranslations('platformBranding');
  const tp = useTranslations('platform');
  const toast = useToast();
  const [view, setView] = useState(initialView);
  const [primary, setPrimary] = useState(view.colors.primary);
  const [secondary, setSecondary] = useState(view.colors.secondary);
  const [lastValid, setLastValid] = useState({
    primary: view.colors.primary,
    secondary: view.colors.secondary,
  });
  const [confirmed, setConfirmed] = useState(false);
  const [serverReport, setServerReport] = useState<ContrastReport | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  const report = useMemo(() => contrastReport(deriveBrandColors(lastValid)), [lastValid]);
  const shownReport = serverReport ?? report;
  const lowContrast = !contrastPasses(shownReport);
  const dirty =
    lastValid.primary !== view.colors.primary || lastValid.secondary !== view.colors.secondary;
  const bothValid =
    hexColorSchema.safeParse(primary).success && hexColorSchema.safeParse(secondary).success;
  const canSave = dirty && bothValid && (!lowContrast || confirmed) && !pending;

  const onColor = (which: 'primary' | 'secondary') => (hex: string) => {
    (which === 'primary' ? setPrimary : setSecondary)(hex);
    setConfirmed(false);
    setServerReport(null);
    setFieldError(undefined);
    const check = hexColorSchema.safeParse(hex);
    if (check.success) setLastValid((prev) => ({ ...prev, [which]: check.data }));
  };

  const save = () => {
    startTransition(async () => {
      const result = await actions.saveColors(tenantId, {
        primary: lastValid.primary,
        secondary: lastValid.secondary,
        ...(lowContrast && confirmed ? { confirmLowContrast: true } : {}),
      });
      if (result.ok) {
        setView(result.view);
        setServerReport(null);
        setConfirmed(false);
        toast.show({ tone: 'success', message: t('toasts.saved') });
      } else if (result.code === 'confirmLowContrast') {
        setServerReport(result.contrastReport);
        setConfirmed(false);
      } else if (result.code === 'hexInvalid') {
        setFieldError(t('errors.hexInvalid'));
      } else {
        toast.show({ tone: 'error', message: t('toasts.error') });
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-6 p-4 md:p-6">
        <SectionTitle variant="micro">{t('colors.title')}</SectionTitle>
        <div className="grid gap-3 md:grid-cols-2">
          <ColorField
            id="primary"
            name="primary"
            label={tp('new.primary')}
            value={primary}
            onChange={onColor('primary')}
            error={fieldError}
            pickLabel={tp('new.pickColor')}
            placeholder={tp('new.hexPlaceholder')}
          />
          <ColorField
            id="secondary"
            name="secondary"
            label={tp('new.secondary')}
            value={secondary}
            onChange={onColor('secondary')}
            error={fieldError}
            pickLabel={tp('new.pickColor')}
            placeholder={tp('new.hexPlaceholder')}
          />
        </div>
        <BrandPreview
          colors={lastValid}
          displayName={view.displayName}
          logoUrl={view.logoUrl}
          labels={previewLabels}
        />
        <ContrastFeedback
          report={shownReport}
          confirmed={confirmed}
          onConfirmedChange={setConfirmed}
        />
        <div className="flex flex-col-reverse gap-3 md:flex-row md:justify-end">
          <Button
            type="button"
            variant="brand"
            size="lg"
            loading={pending}
            disabled={!canSave}
            aria-busy={pending || undefined}
            onClick={save}
            className="w-full md:w-auto"
          >
            {pending ? t('colors.saving') : t('colors.save')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
