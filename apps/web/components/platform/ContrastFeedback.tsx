'use client';

import type { ContrastReport } from '@rede-social/contracts/branding';
import { StatusPill } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { formatContrastRatio } from '@/lib/contrast-ratio';

export interface ContrastFeedbackProps {
  report: ContrastReport;
  /** "Salvar mesmo assim" — the explicit acknowledgement a low-contrast brand requires. */
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
}

const CHECKS = ['onPrimary', 'lightSurface', 'darkSurface'] as const;

/** True when at least one WCAG check of the report fails. */
export function hasLowContrast(report: ContrastReport): boolean {
  return CHECKS.some((key) => !report[key].ok);
}

/**
 * The live contrast readout of a brand (D-41, UI-SPEC E12 form half): three pills — text on the
 * primary (AA 4.5:1), the primary on the light surface and the dark variant on the dark surface
 * (3:1) — plus, when any check fails, the warning copy per failing check and the "Salvar mesmo
 * assim" checkbox. Warnings never block the API; the form gates its own submit on the checkbox.
 * The `BrandPreview` mini-shells are mounted by 02-14 through `NewTenantForm`'s `renderPreview`.
 */
export function ContrastFeedback({ report, confirmed, onConfirmedChange }: ContrastFeedbackProps) {
  const t = useTranslations('platform');
  const failing = CHECKS.filter((key) => !report[key].ok);

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-bold uppercase tracking-wider text-text-tertiary">
        {t('new.contrast.title')}
      </span>
      <div className="flex flex-wrap gap-2">
        {CHECKS.map((key) => {
          const check = report[key];
          const ratio = formatContrastRatio(check.ratio, check.ok);
          return (
            <StatusPill
              key={key}
              tone={check.ok ? 'success' : 'warning'}
              title={t(`new.contrast.${key}`)}
              data-contrast-check={key}
            >
              {check.ok ? t('new.contrast.ok', { ratio }) : t('new.contrast.low', { ratio })}
            </StatusPill>
          );
        })}
      </div>
      {failing.length > 0 ? (
        <div className="flex flex-col gap-2">
          {failing.map((key) => (
            <p key={key} role="alert" className="text-sm text-warning">
              {t('new.contrast.warning', {
                mode:
                  key === 'darkSurface' ? t('new.contrast.modeDark') : t('new.contrast.modeLight'),
                ratio: formatContrastRatio(report[key].ratio, false),
              })}
            </p>
          ))}
          <label
            htmlFor="confirmLowContrast"
            className="flex min-h-11 items-center gap-3 text-sm text-text"
          >
            <input
              id="confirmLowContrast"
              name="confirmLowContrast"
              type="checkbox"
              checked={confirmed}
              onChange={(event) => onConfirmedChange(event.target.checked)}
              className="h-5 w-5 shrink-0 rounded border-border accent-brand"
            />
            {t('new.contrast.confirmLow')}
          </label>
        </div>
      ) : null}
    </div>
  );
}
