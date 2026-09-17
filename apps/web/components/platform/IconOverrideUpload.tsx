'use client';

import { BRANDING_MAX_BYTES } from '@tria/contracts/branding';
import { Button, ConfirmDialog, FileDropZone, SectionTitle, useToast } from '@tria/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { removeIconOverrideAction } from '@/app/(platform)/plataforma/tenants/[id]/marca/actions';
import type { BrandingView } from '@/lib/branding-view';
import { BRANDING_UPLOAD_ACCEPT } from '@/lib/upload';
import { type UploadActions, useSignedUpload } from './LogoUpload';

const ACCEPT = `${BRANDING_UPLOAD_ACCEPT},.png,.svg,.webp,.jpg,.jpeg`;

export interface IconOverrideUploadProps {
  tenantId: string;
  view: BrandingView;
  actions: UploadActions & { removeIcon: typeof removeIconOverrideAction };
  onCompleted: (view: BrandingView) => void;
}

/**
 * The optional square-icon override zone (D-28, UI-SPEC E14): the same signed-PUT flow with
 * `kind: 'icon'`, the current override at 64×64 `rounded-2xl` beside a ghost-danger "Remover" that
 * opens a `ConfirmDialog` ("Remover ícone quadrado?") calling `removeIconOverrideAction`; afterwards
 * the icons re-derive from the logo. The helper copy explains when to use it (E14/empty).
 */
export function IconOverrideUpload({
  tenantId,
  view,
  actions,
  onCompleted,
}: IconOverrideUploadProps) {
  const t = useTranslations('platformBranding');
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const upload = useSignedUpload({ tenantId, kind: 'icon', actions, onCompleted });

  return (
    <div data-upload-zone="icon" className="flex flex-col gap-3">
      <SectionTitle variant="group">{t('icon.title')}</SectionTitle>
      {view.iconUrl ? (
        <div className="flex items-center gap-4">
          {/* biome-ignore lint/performance/noImgElement: D-26/D-28 — the customer's icon is served as-is from the public bucket. */}
          <img
            src={view.iconUrl}
            alt={t('icon.alt', { tenant: view.displayName })}
            className="h-16 w-16 rounded-2xl border border-border object-cover"
            referrerPolicy="no-referrer"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-danger"
            onClick={() => setConfirmOpen(true)}
          >
            {t('icon.remove')}
          </Button>
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
          caption: view.iconUrl ? t('icon.replace') : t('icon.upload'),
          progress: (percent) => t('upload.progress', { percent }),
          processing: t('upload.processing'),
        }}
      />
      <p className="text-xs text-text-tertiary">{t('icon.helper')}</p>
      <ConfirmDialog
        open={confirmOpen}
        tone="danger"
        title={t('icon.confirmTitle')}
        body={t('icon.confirmBody')}
        confirmLabel={t('icon.confirm')}
        cancelLabel={t('icon.cancel')}
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => {
          const result = await actions.removeIcon(tenantId);
          if (!result.ok) throw new Error(result.code);
          onCompleted(result.view);
          toast.show({ tone: 'success', message: t('toasts.saved') });
        }}
        onError={() => toast.show({ tone: 'error', message: t('toasts.error') })}
      />
    </div>
  );
}
