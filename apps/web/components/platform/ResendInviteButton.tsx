'use client';

import { Button, useToast } from '@tria/ui';
import { useTransition } from 'react';
import type { ResendInviteResult } from '@/app/(platform)/plataforma/tenants/[id]/admins/actions';

export interface ResendInviteButtonProps {
  tenantId: string;
  inviteId: string;
  /** False while a `pending` invite has no verified primary host: disabled button + helper line. */
  canResend: boolean;
  labels: {
    resend: string;
    resendPending: string;
    resendHelper: string;
    resent: string;
    resendFailed: string;
  };
  /** `resendInviteAction` — the API call + layout revalidation live in the server action. */
  action: (tenantId: string, inviteId: string) => Promise<ResendInviteResult>;
}

/**
 * The "Reenviar convite" control of the Admins tab (D-30, mockup `tenant-page-admins`), mounted in
 * `AdminsCard`'s typed `resend` slot. Outline button; "Reenviando…" with the spinner and `aria-busy`
 * while the action is in flight (E17 loading); disabled with the helper line while the invite is
 * pending without a verified host (E17 partial). Every outcome ends with a toast. No network call
 * happens here — the server action is the only path to the API.
 */
export function ResendInviteButton({
  tenantId,
  inviteId,
  canResend,
  labels,
  action,
}: ResendInviteButtonProps) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const resend = () => {
    startTransition(async () => {
      const result = await action(tenantId, inviteId);
      toast.show(
        result.ok
          ? { tone: 'success', message: labels.resent }
          : { tone: 'error', message: labels.resendFailed },
      );
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          type="button"
          variant="outline"
          size="md"
          loading={pending}
          disabled={!canResend || pending}
          aria-busy={pending}
          onClick={resend}
        >
          {pending ? labels.resendPending : labels.resend}
        </Button>
      </div>
      {!canResend ? <p className="text-xs text-text-tertiary">{labels.resendHelper}</p> : null}
    </div>
  );
}
