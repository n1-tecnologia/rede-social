'use client';

import { Button, ConfirmDialog, useToast } from '@tria/ui';
import { CalendarX2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { cancelEventAction } from '../actions';

export interface CancelEventControlProps {
  eventId: string;
  /**
   * Where to land after a successful cancel. The edit form passes the event's detail page (the
   * screen contract: "cancel → the detail + its toast"); without it the current page refreshes.
   */
  landing?: string;
}

/**
 * "Cancelar evento" (D-214, UI-D-211): the ghost `text-danger` row at the BOTTOM of the edit form, the
 * UI-D-38 archive position. The form renders it only while the event is active and has not ended;
 * the server computed that flag from the request instant, so this island reads no clock.
 *
 * **Always confirmed first** (the `danger` `ConfirmDialog`, UI-SPEC "Destructive — cancel event"): the
 * body says what cancelling means in V1 — the event stays in every list with its `Cancelado` state,
 * and nobody is notified (D-201). It is reversible until the start ("Reativar evento").
 *
 * A failure toasts and leaves the state unchanged (UI E10/error); a finished event (`event_ended`, a
 * race with the end) also refreshes, so the row disappears.
 */
export function CancelEventControl({ eventId, landing }: CancelEventControlProps) {
  const t = useTranslations('events');
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const cancel = async () => {
    const result = await cancelEventAction(eventId);
    if (!result.ok) {
      toast.show({ tone: 'error', message: t('errors.cancel') });
      if (result.code === 'event_ended') router.refresh();
      return;
    }
    toast.show({ tone: 'success', message: t('toasts.cancelled') });
    if (landing) router.push(landing);
    else router.refresh();
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="md"
        data-event-cancel
        className="justify-start self-start px-0 text-danger"
        onClick={() => setOpen(true)}
      >
        <CalendarX2 aria-hidden size={20} />
        {t('form.cancel')}
      </Button>
      <ConfirmDialog
        open={open}
        tone="danger"
        icon={CalendarX2}
        title={t('confirm.cancel.title')}
        body={t('confirm.cancel.body')}
        confirmLabel={t('confirm.cancel.confirm')}
        cancelLabel={t('confirm.cancel.dismiss')}
        onConfirm={cancel}
        onClose={() => setOpen(false)}
        onError={(error) => {
          // Shape only: never the event's title.
          console.error('events.cancel_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('errors.cancel') });
        }}
      />
    </>
  );
}
