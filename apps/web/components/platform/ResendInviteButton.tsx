'use client';

import { Button, useToast } from '@rede-social/ui';
import { useTransition } from 'react';
import type { ResendInviteResult } from '@/app/(platform)/plataforma/tenants/[id]/admins/actions';

/**
 * The refusal reasons the resend route documents (WR-02/WR-03), plus `no_verified_primary`
 * (02-REVIEW IN-04, 08-08): the tenant has no verified primary host, so no link can be minted.
 */
export const RESEND_REFUSAL_REASONS = [
  'email_in_use',
  'user_in_other_tenant',
  'no_verified_primary',
] as const;
export type ResendRefusalReason = (typeof RESEND_REFUSAL_REASONS)[number];

/** The reason-specific copy for an API refusal, or undefined (the caller falls back to generic). */
export function resendReasonCopy(
  reason: string | undefined,
  reasons: Partial<Record<ResendRefusalReason, string>> | undefined,
): string | undefined {
  return (RESEND_REFUSAL_REASONS as readonly (string | undefined)[]).includes(reason)
    ? reasons?.[reason as ResendRefusalReason]
    : undefined;
}

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
    /**
     * Reason-specific failure copy keyed by the API's `details.reason` (WR-02/WR-03, IN-04). Only
     * the documented refusals are known; any other reason falls back to `resendFailed`.
     */
    reasons?: Partial<Record<ResendRefusalReason, string>>;
  };
  /** `resendInviteAction` — the API call + layout revalidation live in the server action. */
  action: (tenantId: string, inviteId: string) => Promise<ResendInviteResult>;
}

/**
 * The "Reenviar convite" control of the Admins tab (D-30, mockup `tenant-page-admins`), mounted in
 * `AdminsCard`'s typed `resend` slot. Outline button; "Reenviando…" with the spinner and `aria-busy`
 * while the action is in flight (E17 loading); disabled with the helper line while the invite is
 * pending without a verified host (E17 partial). Every outcome ends with a toast: a refusal with a
 * documented reason toasts its own copy (WR-02/WR-03), any other failure the generic copy — always
 * from the catalog, never the API message. No network call happens here — the server action is the
 * only path to the API.
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
          : {
              tone: 'error',
              message: resendReasonCopy(result.reason, labels.reasons) ?? labels.resendFailed,
            },
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
