'use client';

import { Card, SectionTitle } from '@tria/ui';
import { Check, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { BrandingView } from '@/lib/branding-view';

export type IconsStatus = 'generating' | 'ready' | 'slow';

export interface DerivedIconsProps {
  view: BrandingView;
  status: IconsStatus;
}

/**
 * The app-icons card (D-28, UI-SPEC E14): nothing without a logo or override (zero-one-many —
 * never a partial set); otherwise an honest status line — "Ícones sendo gerados…" (Loader2) while
 * `iconsUpToDate` is false, "Ícones gerados" with the four 40×40 thumbs once the worker wrote the
 * set for the current `iconVersion`, or the "slow" copy when the bounded poll gave up — plus the
 * version and source captions. Thumbs are `<img>` from API-written URLs only (T-02-112).
 */
export function DerivedIcons({ view, status }: DerivedIconsProps) {
  const t = useTranslations('platformBranding');
  if (!view.hasSource) return null;
  const ready = status === 'ready' && view.iconUrls !== null && view.faviconUrl !== null;

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-6">
      <SectionTitle variant="micro">{t('icons.title')}</SectionTitle>
      <p
        role="status"
        aria-live="polite"
        data-icons-status={status}
        className="flex items-center gap-2 text-sm text-text-secondary"
      >
        {status === 'generating' ? (
          <Loader2 className="animate-spin" size={16} aria-hidden />
        ) : null}
        {status === 'ready' ? <Check size={16} aria-hidden className="text-success" /> : null}
        {status === 'generating'
          ? t('icons.generating')
          : status === 'ready'
            ? t('icons.ready')
            : t('icons.slow')}
      </p>
      {ready && view.iconUrls && view.faviconUrl ? (
        <ul className="flex flex-wrap gap-3">
          <li
            data-icon-thumb
            className="flex flex-col items-center gap-1 text-[11px] text-text-tertiary"
          >
            <span className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-bg">
              {/* biome-ignore lint/performance/noImgElement: derived favicon from the public bucket, shown as-is. */}
              <img src={view.faviconUrl} width={16} height={16} alt="" className="h-4 w-4" />
            </span>
            {t('icons.favicon')}
          </li>
          {(
            [
              ['i192', view.iconUrls.i192],
              ['i512', view.iconUrls.i512],
              ['maskable', view.iconUrls.maskable512],
            ] as const
          ).map(([key, src]) => (
            <li
              key={key}
              data-icon-thumb
              className="flex flex-col items-center gap-1 text-[11px] text-text-tertiary"
            >
              {/* biome-ignore lint/performance/noImgElement: derived icon from the public bucket, shown as-is. */}
              <img
                src={src}
                width={40}
                height={40}
                alt=""
                className="h-10 w-10 rounded-lg border border-border object-contain"
              />
              {t(`icons.${key}`)}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="flex flex-wrap gap-x-3 text-xs text-text-tertiary">
        <span>{t('icons.version', { version: view.iconVersion })}</span>
        <span>{view.iconUrl ? t('icons.fromOverride') : t('icons.fromLogo')}</span>
      </p>
    </Card>
  );
}
