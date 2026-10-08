'use client';

import { Button, ConfirmDialog, useToast } from '@rede-social/ui';
import { ArchiveRestore } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { setProductStatusAction } from '../product-actions';

/**
 * The archived product's "Reativar produto" for a manager (UI-D-369, UI-D-377), the
 * `ReactivateCommunity` island: an `outline` control under the archived note that opens the
 * reactivate `ConfirmDialog` (`tone="brand"`: reactivating restores and destroys nothing).
 *
 * Confirming calls `PUT /v1/store/products/{id}/status { status: 'active' }` through
 * `setProductStatusAction` (idempotent: a second tap writes nothing), toasts "Produto reativado." and
 * `router.refresh()`es, so the SAME page re-renders as active in place (the pill and the note go).
 * Any refusal keeps the page as it is with the control still available.
 */
export function ReactivateProduct({ productId }: { productId: string }) {
  const t = useTranslations('store');
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const reactivate = async () => {
    const result = await setProductStatusAction(productId, 'active');
    if (!result.ok) {
      toast.show({ tone: 'error', message: t('errors.reactivate') });
      return;
    }
    toast.show({ tone: 'success', message: t('toasts.reactivated') });
    router.refresh();
  };

  return (
    <>
      <Button variant="outline" size="md" data-store-reactivate onClick={() => setOpen(true)}>
        <ArchiveRestore aria-hidden size={18} className="shrink-0" />
        {t('product.archived.reactivate')}
      </Button>
      <ConfirmDialog
        open={open}
        tone="brand"
        icon={ArchiveRestore}
        title={t('form.reactivateDialog.title')}
        body={t('form.reactivateDialog.body')}
        confirmLabel={t('form.reactivateDialog.confirm')}
        cancelLabel={t('form.reactivateDialog.cancel')}
        onConfirm={reactivate}
        onClose={() => setOpen(false)}
        onError={(error) => {
          // Shape only: never the product's name.
          console.error('store.reactivate_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('errors.reactivate') });
        }}
      />
    </>
  );
}
