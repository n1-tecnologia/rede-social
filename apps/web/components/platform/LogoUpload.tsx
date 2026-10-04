'use client';

import { BRANDING_MAX_BYTES } from '@rede-social/contracts/branding';
import { FileDropZone, type FileDropZoneState, SectionTitle, useToast } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import {
  brandingUploadErrorKey,
  runBrandingUpload,
  type UploadActions,
} from '@/lib/branding-upload';
import type { BrandingView } from '@/lib/branding-view';
import { BRANDING_UPLOAD_ACCEPT, classifyFile, resolveMime } from '@/lib/upload';

export type { UploadActions } from '@/lib/branding-upload';

/** `<input accept>`: the contracts allow-list plus the extensions (some browsers leave SVG's type empty). */
const ACCEPT = `${BRANDING_UPLOAD_ACCEPT},.png,.svg,.webp,.jpg,.jpeg`;

/**
 * The signed-upload flow shared by the logo and the square-icon zones (02-14, D-27, CLAUDE.md §4):
 * `runBrandingUpload` (`classifyFile` → `start` → browser PUT straight to Storage with progress →
 * `complete`) → `onCompleted(view)` + toast. One in-flight upload per zone;
 * every failure path — including a REJECTED server action or a thrown transfer — returns the zone to
 * idle with the pt-BR generic message (UI-SPEC "Error state — upload", WR-07); the raw error goes to
 * the console only, never to the user (T-02-147). The signed URL lives in this closure for the
 * duration of the PUT only (T-02-110).
 */
export function useSignedUpload({
  tenantId,
  kind,
  actions,
  onCompleted,
}: {
  tenantId: string;
  kind: 'logo' | 'icon';
  actions: UploadActions;
  onCompleted: (view: BrandingView) => void;
}) {
  const t = useTranslations('platformBranding');
  const toast = useToast();
  const [state, setState] = useState<FileDropZoneState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const fail = (message: string) => {
    setError(message);
    setState('idle');
    setProgress(0);
    busy.current = false;
  };

  const onReject = (reason: 'type' | 'size') => {
    if (busy.current) return;
    setError(t(`errors.${reason}`));
  };

  const onFile = async (file: File) => {
    if (busy.current) return;
    try {
      setError(null);
      // The UX gate before any state change: a wrong type or size never shows the progress bar.
      const rejected = classifyFile(file) ?? (resolveMime(file) ? null : 'type');
      if (rejected) return setError(t(`errors.${rejected}`));
      busy.current = true;
      setState('progress');
      setProgress(0);

      const outcome = await runBrandingUpload({
        tenantId,
        kind,
        file,
        actions,
        onProgress: setProgress,
        onProcessing: () => setState('processing'),
      });
      if (!outcome.ok) return fail(t(brandingUploadErrorKey(outcome.code)));

      busy.current = false;
      setState('idle');
      setProgress(0);
      onCompleted(outcome.view);
      toast.show({ tone: 'success', message: t('toasts.saved') });
    } catch (error) {
      // A rejected action / thrown transfer (WR-07): `fail` resets busy, state and progress. Kept as
      // try + catch only — the success path above must not re-run `fail` after `onCompleted`.
      console.error('platform.branding.upload_failed', { kind, error: String(error) });
      fail(t('errors.generic'));
    }
  };

  const reset = () => {
    setError(null);
    setState('idle');
    setProgress(0);
    busy.current = false;
  };

  return { state, progress, error, onFile, onReject, reset };
}

export interface LogoUploadProps {
  tenantId: string;
  view: BrandingView;
  actions: UploadActions;
  onCompleted: (view: BrandingView) => void;
}

/**
 * The "Logo" zone (mockup `tenant-page-marca`, UI-SPEC E14): the current logo `h-16 object-contain`
 * on `bg-bg` when there is one (SVG through `<img>` only — scripts never execute, T-02-112), the
 * `FileDropZone` with the empty caption "Nenhum logo enviado…" (D-26) or the format hint, the 4 px
 * brand progress bar and the "Gerando ícones…" processing caption.
 */
export function LogoUpload({ tenantId, view, actions, onCompleted }: LogoUploadProps) {
  const t = useTranslations('platformBranding');
  const upload = useSignedUpload({ tenantId, kind: 'logo', actions, onCompleted });

  return (
    <div data-upload-zone="logo" className="flex flex-col gap-3">
      <SectionTitle variant="group">{t('logo.title')}</SectionTitle>
      {view.logoUrl ? (
        <div className="flex h-24 items-center justify-center rounded-xl bg-bg px-4">
          {/* biome-ignore lint/performance/noImgElement: D-26 — the customer's logo is served as-is (any format, any origin); next/image would re-encode and constrain it. */}
          <img
            src={view.logoUrl}
            alt={t('logo.alt', { tenant: view.displayName })}
            className="h-16 max-w-full object-contain"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : null}
      <FileDropZone
        accept={ACCEPT}
        maxBytes={BRANDING_MAX_BYTES}
        state={upload.state}
        progress={upload.progress}
        error={upload.error ?? undefined}
        onFile={upload.onFile}
        onReject={upload.onReject}
        labels={{
          caption: view.logoUrl ? t('logo.replace') : t('logo.upload'),
          progress: (percent) => t('upload.progress', { percent }),
          processing: t('upload.processing'),
        }}
      />
      <p className="text-xs text-text-tertiary">
        {view.logoUrl ? t('logo.hint') : t('logo.empty')}
      </p>
    </div>
  );
}
