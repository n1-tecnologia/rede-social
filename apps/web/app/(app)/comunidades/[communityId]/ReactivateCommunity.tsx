'use client';

import { Button, ConfirmDialog, useToast } from '@tria/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { reactivateCommunityAction } from '../actions';

/**
 * The archived page's one-tap Reativar (D-90, UI-D-52) — a small client island the page drops into
 * `CommunityHeader`'s existing `note` slot, under the archived note, for `canManage` only.
 *
 * **A page control, never a card button (D-90).** Reactivating republishes a community to every
 * member's list, so it lives where the manager is already looking at THAT community — its own
 * page — and always passes through an explained confirmation. The edit form's control stays as a
 * second route; no list card gains a button.
 *
 * **`tone="brand"`, not `danger`.** Reactivation restores and destroys nothing (UI-D-52; the edit
 * form's control is `outline` for the same reason). The confirm costs one tap and says what
 * happens: the community returns to the list and can receive posts again.
 *
 * **`router.refresh()`, not a navigation (Pitfall 8).** `reactivateCommunityAction` already
 * revalidates `/comunidades` and this page; a refresh re-renders the SAME page as active in place —
 * the pill, the note and this button disappear, the compose entry and the Destaques `+` appear.
 *
 * A second confirm tap is inert: `ConfirmDialog` ignores taps while `onConfirm` is pending, and the
 * API's PATCH to `active` on an already-active community writes nothing (T-05.1-41).
 */
export function ReactivateCommunity({ communityId }: { communityId: string }) {
  const t = useTranslations('communities');
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const reactivate = async () => {
    const result = await reactivateCommunityAction(communityId);
    if (!result.ok) {
      // UI E04/error: `not_found` included — V1 has no community delete, so any refusal reads the
      // same retryable line, and the page stays archived with this button still available.
      toast.show({ tone: 'error', message: t('errors.reactivate') });
      return;
    }
    toast.show({ tone: 'success', message: t('toasts.reactivated') });
    router.refresh();
  };

  return (
    <div className="mt-3">
      <Button
        variant="outline"
        size="md"
        data-community-page-reactivate
        onClick={() => setOpen(true)}
      >
        {t('archived.reactivate')}
      </Button>
      <ConfirmDialog
        open={open}
        tone="brand"
        title={t('confirm.reactivate.title')}
        body={t('confirm.reactivate.body')}
        confirmLabel={t('confirm.reactivate.confirm')}
        cancelLabel={t('confirm.reactivate.cancel')}
        onConfirm={reactivate}
        onClose={() => setOpen(false)}
        onError={(error) => {
          // Shape only: never the community's name (T-05-06).
          console.error('communities.reactivate_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('errors.reactivate') });
        }}
      />
    </div>
  );
}
