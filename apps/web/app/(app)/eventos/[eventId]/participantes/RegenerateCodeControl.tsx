'use client';

import { Button, ConfirmDialog, useToast } from '@rede-social/ui';
import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { regenerateCheckinCodeAction } from '../../actions';

export interface RegenerateCodeControlProps {
  eventId: string;
}

/**
 * "Gerar novo código" (D-217, UI-D-213, sketch 006 Surface 6): the `ghost sm` control in the code
 * card's action slot. The PAGE renders it only with `events.event.manage`; the API's literal manage
 * guard is the authority either way (T-06-45).
 *
 * **`tone="danger"`** (UI-SPEC Destructive): the current code stops working the moment the confirm
 * lands, so a member typing it at the door is refused. Existing check-ins are kept, and the confirm
 * says so.
 *
 * The write is a SERVER ACTION (a POST), never a link or a GET (the 06-06 side-effect rule). On
 * success it toasts "Novo código gerado." and refreshes in place, so the RSC read shows the new code;
 * the code itself never travels through this component.
 */
export function RegenerateCodeControl({ eventId }: RegenerateCodeControlProps) {
  const t = useTranslations('events');
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const regenerate = async () => {
    const result = await regenerateCheckinCodeAction(eventId);
    if (!result.ok) {
      toast.show({ tone: 'error', message: t('errors.regenerate') });
      if (result.code === 'not_found') router.refresh();
      return;
    }
    toast.show({ tone: 'success', message: t('toasts.codeRegenerated') });
    router.refresh();
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-regenerate-code
        onClick={() => setOpen(true)}
      >
        {t('participants.code.regenerate')}
      </Button>
      <ConfirmDialog
        open={open}
        tone="danger"
        icon={RefreshCw}
        title={t('confirm.regenerate.title')}
        body={t('confirm.regenerate.body')}
        confirmLabel={t('confirm.regenerate.confirm')}
        cancelLabel={t('confirm.regenerate.dismiss')}
        onConfirm={regenerate}
        onClose={() => setOpen(false)}
        onError={(error) => {
          console.error('events.regenerate_code_failed', { error: String(error) });
          toast.show({ tone: 'error', message: t('errors.regenerate') });
        }}
      />
    </>
  );
}
