'use client';

import {
  type ContrastReport,
  contrastPasses,
  contrastReport,
  deriveBrandColors,
  hexColorSchema,
} from '@rede-social/contracts/branding';
import { BrandPreview, type BrandPreviewLabels } from '@rede-social/core/ui';
import { Button, Card, SectionTitle, useToast } from '@rede-social/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, useTransition } from 'react';
import type {
  completeBrandingUploadAction,
  getBrandingStatusAction,
  removeIconOverrideAction,
  saveBrandColorsAction,
  startBrandingUploadAction,
} from '@/app/(platform)/plataforma/tenants/[id]/marca/actions';
import type { BrandingView } from '@/lib/branding-view';
import { ColorField } from './ColorField';
import { ContrastFeedback } from './ContrastFeedback';
import { DerivedIcons, type IconsStatus } from './DerivedIcons';
import { IconOverrideUpload } from './IconOverrideUpload';
import { LogoUpload } from './LogoUpload';

/**
 * The server actions the form calls. The assets card renders only when the three upload actions
 * are present (the page passes all five; a caller without uploads gets the colours card alone).
 */
export type BrandingActions = {
  saveColors: typeof saveBrandColorsAction;
  status: typeof getBrandingStatusAction;
  start?: typeof startBrandingUploadAction;
  complete?: typeof completeBrandingUploadAction;
  removeIcon?: typeof removeIconOverrideAction;
};

/** Icon-derivation poll: every 3 s, at most 20 times (≈ 60 s), then the honest "slow" copy (D-28). */
const POLL_MS = 3000;
const pollExhausted = (attempts: number) => attempts >= 20;

export interface BrandingFormProps {
  tenantId: string;
  /**
   * The server-rendered view. The page keys the form on the tenant only; a new view (a refresh) is
   * adopted in place, so typed colours survive it.
   */
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
 *
 * Assets card (Task 2): `LogoUpload` + `IconOverrideUpload` feed `applyView`; the app-icons card
 * polls `getBrandingStatusAction` every 3 s (at most 20 times) while `iconsReady` is false, drops a
 * stale answer (older `iconVersion`, T-02-117) and refreshes the route once the set is ready.
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
  const router = useRouter();
  const [view, setView] = useState(initialView);
  /** The last `view` prop seen — a new one is a server refresh to adopt (below `applyView`). */
  const [seed, setSeed] = useState(initialView);
  const [attempts, setAttempts] = useState(0);
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

  /**
   * A fresh view from an upload/removal or a server refresh: adopt it and, when the colours were not
   * being edited, follow it. "Not edited" covers the raw fields too, so a half-typed (still invalid)
   * hex is never overwritten.
   */
  const applyView = (next: BrandingView) => {
    const untouched =
      lastValid.primary === view.colors.primary &&
      lastValid.secondary === view.colors.secondary &&
      primary === view.colors.primary &&
      secondary === view.colors.secondary;
    if (untouched) {
      setPrimary(next.colors.primary);
      setSecondary(next.colors.secondary);
      setLastValid({ primary: next.colors.primary, secondary: next.colors.secondary });
    }
    setView(next);
    setAttempts(0);
  };

  // A refreshed server view (the poll's `router.refresh()` once the icons are ready, an action's
  // `revalidatePath`) arrives as a new `view` prop. The page no longer remounts the form for it
  // (08-02, WINDOWS #71: the remount dropped a colour typed while the refresh was in flight), so it
  // is adopted here, during render, with the same rule as an upload. A view older than the one on
  // screen (a lower `iconVersion`) is dropped, like a stale poll answer (T-02-117).
  if (seed !== initialView) {
    setSeed(initialView);
    if (initialView.iconVersion >= view.iconVersion) applyView(initialView);
  }

  const iconStatus: IconsStatus = view.iconsReady
    ? 'ready'
    : pollExhausted(attempts)
      ? 'slow'
      : 'generating';

  useEffect(() => {
    if (!view.hasSource || view.iconsReady || pollExhausted(attempts)) return;
    const id = setTimeout(async () => {
      const result = await actions.status(tenantId);
      if (result.ok && result.view.iconVersion >= view.iconVersion) {
        setView(result.view);
        if (result.view.iconsReady) router.refresh();
      }
      setAttempts((n) => n + 1);
    }, POLL_MS);
    return () => clearTimeout(id);
  }, [view.hasSource, view.iconsReady, view.iconVersion, attempts, tenantId, actions, router]);

  const uploads =
    actions.start && actions.complete && actions.removeIcon
      ? { start: actions.start, complete: actions.complete, removeIcon: actions.removeIcon }
      : null;

  const save = () => {
    startTransition(async () => {
      const result = await actions.saveColors(tenantId, {
        primary: lastValid.primary,
        secondary: lastValid.secondary,
        ...(lowContrast && confirmed ? { confirmLowContrast: true } : {}),
      });
      if (result.ok) {
        setView(result.view);
        setAttempts(0);
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
      {uploads ? (
        <Card className="flex flex-col gap-6 p-4 md:p-6">
          <SectionTitle variant="micro">{t('assets.title')}</SectionTitle>
          <div className="grid gap-6 md:grid-cols-2">
            <LogoUpload tenantId={tenantId} view={view} actions={uploads} onCompleted={applyView} />
            <IconOverrideUpload
              tenantId={tenantId}
              view={view}
              actions={uploads}
              onCompleted={applyView}
            />
          </div>
        </Card>
      ) : null}
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
      <DerivedIcons view={view} status={iconStatus} />
    </div>
  );
}
