'use client';

import { Button, ConfirmDialog, useToast } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { removeIconOverrideAction } from '@/app/(platform)/plataforma/tenants/[id]/marca/actions';
import type { BrandingView } from '@/lib/branding-view';
import { AppIconEditor, type AppIconLogo } from './AppIconEditor';
import { type UploadActions, useSignedUpload } from './LogoUpload';

export interface IconOverrideUploadProps {
  tenantId: string;
  view: BrandingView;
  /** The SAVED primary: the icon's default ground, and Android's circle in the preview. */
  primary: string;
  /** The dark mode's logo picked for the previews (`DarkLogoProvider`), one more source to start from. */
  logoDark?: AppIconLogo | null;
  actions: UploadActions & { removeIcon: typeof removeIconOverrideAction };
  onCompleted: (view: BrandingView) => void;
  className?: string;
}

/**
 * The "Ícone do app" of the Marca tab (D-28, 2026-10-09): the app-icon editor (`AppIconEditor`)
 * over the square-override upload. The composed icon goes through the same signed-PUT flow as any
 * override (`useSignedUpload` with `kind: 'icon'`), and the editor closes once it is recorded; the
 * worker then derives the icon set from it ("Gerados a partir do ícone do app"). With an icon of its
 * own, a ghost-danger "Remover" opens a `ConfirmDialog` ("Remover o ícone do app?") calling
 * `removeIconOverrideAction`; afterwards the icons re-derive from the logo, or, for a tenant without
 * one, from the set's previous render, so the editor shows that served set (`derivedIconUrl`, its
 * Apple icon) instead of empty tiles. "Remover" leaves with the icon it removed, so the dialog's
 * focus trap has no opener to return to: once the dialog has closed, the focus goes to the editor's
 * "Personalizar ícone" instead of falling to `<body>`.
 */
export function IconOverrideUpload({
  tenantId,
  view,
  primary,
  logoDark = null,
  actions,
  onCompleted,
  className,
}: IconOverrideUploadProps) {
  const t = useTranslations('platformBranding');
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const upload = useSignedUpload({ tenantId, kind: 'icon', actions, onCompleted });
  const editorRoot = useRef<HTMLDivElement>(null);
  /** The dialog confirmed a removal: its closing hands the focus to the editor. */
  const removed = useRef(false);

  // Runs after the dialog's own focus trap let go (its opener, "Remover", left with the icon): the
  // editor's button takes the focus that would otherwise fall to <body> with the dialog.
  useEffect(() => {
    if (confirmOpen || !removed.current) return;
    removed.current = false;
    editorRoot.current?.querySelector<HTMLElement>('[data-app-icon-open]')?.focus();
  }, [confirmOpen]);

  return (
    <>
      <AppIconEditor
        marker={{ 'data-upload-zone': 'icon' }}
        rootRef={editorRoot}
        className={className}
        displayName={view.displayName}
        primary={primary}
        logos={{ light: view.logoUrl ? { url: view.logoUrl } : null, dark: logoDark }}
        iconUrl={view.iconUrl}
        derivedIconUrl={view.iconUrls?.apple180 ?? null}
        onApply={(file) => upload.onFile(file)}
        upload={{ state: upload.state, progress: upload.progress, error: upload.error }}
        persisted
        removeAction={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-danger"
            onClick={() => setConfirmOpen(true)}
          >
            {t('icon.remove')}
          </Button>
        }
      />
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
          removed.current = true;
          onCompleted(result.view);
          toast.show({ tone: 'success', message: t('toasts.saved') });
        }}
        onError={() => toast.show({ tone: 'error', message: t('toasts.error') })}
      />
    </>
  );
}
