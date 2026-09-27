'use client';

import { Button, ConfirmDialog, useToast } from '@tria/ui';
import { RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { reactivateEventAction } from '../actions';

export interface ReactivateEventControlProps {
  eventId: string;
  /** Where to land after success; without it the current page refreshes in place (the banner). */
  landing?: string;
}

/**
 * "Reativar evento" (D-214, UI-D-211): the `outline` control with TWO doors, the cancelled banner on
 * the detail page and the bottom row of the edit form. Both render it only while the event has not
 * started, a flag the server computed from the request instant (no clock is read here).
 *
 * **`tone="brand"`, not `danger`** (the `ReactivateCommunity` precedent): reactivating restores and
 * destroys nothing, and the confirm says so — answers given before the cancel still count.
 *
 * On success it toasts and refreshes in place (Pitfall 8: the action already revalidated the list and
 * the detail), or lands where the form asked. `reactivate_started` (a race with the start) toasts its
 * own line and refreshes, so the door closes; any other failure toasts and changes nothing.
 */
export function ReactivateEventControl({ eventId, landing }: ReactivateEventControlProps) {
  const t = useTranslations('events');
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const reactivate = async () => {
    const result = await reactivateEventAction(eventId);
    if (!result.ok) {
      if (result.code === 'reactivate_started') {
        toast.show({ tone: 'error', message: t('errors.reactivateStarted') });
        router.refresh();
        return;
      }
      toast.show({ tone: 'error', message: t('errors.reactivate') });
      return;
    }
    toast.show({ tone: 'success', message: t('toasts.reactivated') });
    if (landing) router.push(landing);
    else router.refresh();
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="md"
        data-event-reactivate
        className="self-start"
        onClick={() => setOpen(true)}
      >
        {t('reactivate.action')}
      </Button>
      <ConfirmDialog
        open={open}
        tone="brand"
        icon={RotateCcw}
        title={t('confirm.reactivate.title')}
        body={t('confirm.reactivate.body')}
        confirmLabel={t('confirm.reactivate.confirm')}
        cancelLabel={t('confirm.reactivate.dismiss')}
        onConfirm={reactivate}
        onClose={() => setOpen(false)}
        onError={(error) => {
          console.error('events.reactivate_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('errors.reactivate') });
        }}
      />
    </>
  );
}
