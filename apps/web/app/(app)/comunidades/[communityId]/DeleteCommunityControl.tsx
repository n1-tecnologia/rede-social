'use client';

import { ConfirmDialog, cn, useToast } from '@rede-social/ui';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { deleteCommunityAction } from '../actions';

export interface DeleteCommunityControlProps {
  communityId: string;
  className?: string;
}

/** What the refusal dialog draws: the products the API named and the TOTAL (D-554). */
interface Blocked {
  products: { id: string; name: string }[];
  count: number;
}

/**
 * "Excluir comunidade" (D-553, D-554, D-557, PEND-07): the danger trigger of an ARCHIVED community's
 * page note and of its edit form's archived branch, for whoever may manage communities. The model is
 * `ReactivateCommunity` (a page control, always behind an explained confirmation) and the sibling
 * `DeleteEventControl`, whose trigger markup and classes it repeats.
 *
 * **Always confirmed first** (the `danger` `ConfirmDialog`): the fixed copy says what disappears and
 * that there is no undoing it. The copy never interpolates the community's name and this island takes
 * none, so no name can reach a toast, the dialog or a console call (T-05-06, T-09.3-43). The pending
 * state is `ConfirmDialog`'s own: it covers the trigger, ignores a second tap and keeps Escape and the
 * backdrop inert, so the trigger itself has no loading state.
 *
 * **The refusal is a second dialog, not a toast (D-554).** When an active Loja product still unlocks
 * the community the API answers `409 unlock_active` and the action hands back the products and the
 * total. `ConfirmDialog` closes itself when `onConfirm` settles, so `remove` sets the refusal state
 * BEFORE it returns and the second dialog opens as the first closes. Its confirm is "Ver produtos"
 * (a plain navigation to `/loja`) and "Fechar" dismisses it; it never changes anything in the Loja.
 * The names are React text nodes in `break-words` list items, capped by the API at five, and the plural
 * and the "e mais N" line follow the TOTAL, never the number of names listed.
 *
 * **The landing is `replace('/comunidades')`**, never `push`: the community's page and its edit form
 * are dead after the delete, so neither may be the previous history entry. Outcomes: success (toast,
 * landing), the 404 race (an info toast that it is already gone, then the same landing), the stale
 * page whose community is no longer archived (error toast, `refresh` so the trigger disappears) and a
 * failure (error toast, the page stays and the trigger remains available).
 */
export function DeleteCommunityControl({ communityId, className }: DeleteCommunityControlProps) {
  const t = useTranslations('communities');
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // The refusal is kept after it closes, so the dialog does not empty itself while it fades out.
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [blockedOpen, setBlockedOpen] = useState(false);

  const remove = async () => {
    const result = await deleteCommunityAction(communityId);
    if (result.ok) {
      toast.show({ tone: 'success', message: t('toasts.deleted') });
      router.replace('/comunidades');
      return;
    }
    switch (result.code) {
      case 'not_found':
        toast.show({ tone: 'info', message: t('errors.deleteGone') });
        router.replace('/comunidades');
        return;
      case 'not_archived':
        toast.show({ tone: 'error', message: t('errors.deleteNotArchived') });
        router.refresh();
        return;
      case 'unlock_active':
        setBlocked({ products: result.products, count: result.count });
        setBlockedOpen(true);
        return;
      default:
        toast.show({ tone: 'error', message: t('errors.delete') });
    }
  };

  return (
    <div
      data-delete-control="community"
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        className="inline-flex h-11 items-center gap-2 rounded-xl text-sm font-bold text-danger transition-opacity active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        onClick={() => setOpen(true)}
      >
        <Trash2 aria-hidden size={20} />
        {t('delete.action')}
      </button>
      <ConfirmDialog
        open={open}
        tone="danger"
        icon={Trash2}
        title={t('confirm.delete.title')}
        body={t('confirm.delete.body')}
        confirmLabel={t('confirm.delete.confirm')}
        cancelLabel={t('confirm.delete.cancel')}
        onConfirm={remove}
        onClose={() => setOpen(false)}
        onError={(error) => {
          // Shape only: never the community's name (T-05-06).
          console.error('communities.delete_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('errors.delete') });
        }}
      />
      <ConfirmDialog
        open={blockedOpen && blocked !== null}
        tone="brand"
        scrollBody
        title={t('blocked.title')}
        body={blocked ? t('blocked.body', { count: blocked.count }) : undefined}
        confirmLabel={t('blocked.confirm')}
        cancelLabel={t('blocked.cancel')}
        onConfirm={() => router.push('/loja')}
        onClose={() => setBlockedOpen(false)}
      >
        {blocked ? (
          <>
            <ul className="list-disc pl-4 text-sm text-text">
              {blocked.products.map((product) => (
                <li key={product.id} className="break-words">
                  {product.name}
                </li>
              ))}
            </ul>
            {blocked.count > blocked.products.length ? (
              <p className="mt-1 text-sm text-text-secondary">
                {t('blocked.more', { count: blocked.count - blocked.products.length })}
              </p>
            ) : null}
          </>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
