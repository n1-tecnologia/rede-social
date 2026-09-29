import { Avatar, Card, SectionTitle, StatusPill } from '@rede-social/ui';
import type { ReactNode } from 'react';

export type InviteView = {
  email: string;
  /**
   * View-only states derived by `deriveInviteState` from the contract's four statuses (the API
   * contract never learns of them): `awaiting_domain` / `unsent` split `pending` on whether the
   * tenant has a verified primary host (quick 260929-g0s); `refused` is `expired` with `sentAt`
   * null (a refused first-admin e-mail, 02-19 D-A).
   */
  status: 'awaiting_domain' | 'unsent' | 'sent' | 'accepted' | 'expired' | 'refused';
  /** Pre-formatted on the server (`formatPanelDate(sentAt, 'dateTime')`). */
  sentAtLabel: string | null;
  /** Pre-formatted on the server (`formatPanelDate(acceptedAt)`). */
  acceptedAtLabel: string | null;
};

export type AdminView = { userId: string; name: string; email: string };

export interface AdminsCardLabels {
  inviteTitle: string;
  noInvite: string;
  /** Pending and the tenant has no verified primary host yet: nothing can be sent. */
  inviteAwaitingDomain: string;
  /** Pending with a verified primary: the automatic send is queued (or failed) — the button sends now. */
  inviteUnsent: string;
  /** Already interpolated with the sent date. */
  inviteSent: string;
  /** Already interpolated with the accepted date. */
  inviteAccepted: string;
  inviteExpired: string;
  /** The refused pill (WR-02/WR-03): the e-mail already belongs to an identity on the platform. */
  inviteRefused: string;
  adminsTitle: string;
  role: string;
  empty: string;
}

export interface AdminsCardProps {
  invite: InviteView | null;
  admins: AdminView[];
  labels: AdminsCardLabels;
  /**
   * The "Enviar convite" / "Reenviar convite" control (D-30). 02-12 passes nothing; plan 02-10 mounts
   * the outline button + helper wired to `POST /v1/platform/tenants/{id}/invites/{inviteId}/resend`.
   */
  resend?: ReactNode;
}

/** The contract fields `deriveInviteState` reads (the `TenantInvite` shape, dates as ISO strings). */
export type InviteStateInput = {
  status: 'pending' | 'sent' | 'accepted' | 'expired';
  sentAt: string | null;
};

export type InviteState = {
  status: InviteView['status'];
  /** `send` while the invite was never mailed (`sentAt` null), `resend` after a send, null once accepted. */
  action: 'send' | 'resend' | null;
  /** False whenever no verified primary host exists: the button is disabled with the helper line. */
  canSend: boolean;
};

/**
 * Where the first-admin invite stands (quick 260929-g0s), pure so the page and the tests share it:
 *
 *   pending, no verified primary     -> awaiting_domain, send (disabled)
 *   pending, verified primary        -> unsent, send (the automatic send is queued or failed)
 *   sent                             -> sent, resend
 *   accepted                         -> accepted, no action
 *   expired, sentAt null (refused)   -> refused, send (never mailed — 02-19 D-A)
 *   expired, sentAt set (lapsed)     -> expired, resend
 *
 * `canSend` is false for every non-accepted state while the tenant has no verified primary host:
 * the link must open the tenant's own origin, so the API would refuse anyway (D-36).
 */
export function deriveInviteState(invite: InviteStateInput, hasVerifiedHost: boolean): InviteState {
  const status: InviteView['status'] =
    invite.status === 'pending'
      ? hasVerifiedHost
        ? 'unsent'
        : 'awaiting_domain'
      : invite.status === 'expired' && invite.sentAt === null
        ? 'refused'
        : invite.status;
  const action =
    invite.status === 'accepted' ? null : invite.sentAt === null ? ('send' as const) : 'resend';
  return { status, action, canSend: action !== null && hasVerifiedHost };
}

const inviteTone = {
  awaiting_domain: 'warning',
  unsent: 'warning',
  sent: 'neutral',
  accepted: 'success',
  expired: 'danger',
  refused: 'danger',
} as const;

/**
 * Admins tab (D-29/D-30, mockup `tenant-page-admins`), server-safe (no hooks): the first-admin
 * invite card (e-mail + the state pill from `deriveInviteState` — awaiting domain, not sent yet,
 * sent on <date/time>, accepted on <date>, expired, refused — + the typed send/resend slot) and the
 * "Administradores" card listing
 * `admin_tenant` memberships. Long e-mails `break-all` at 12/14 px so a 60-character address never
 * overflows (E17 backstop); an admin without a profile name shows the e-mail in the name slot.
 */
export function AdminsCard({ invite, admins, labels, resend }: AdminsCardProps) {
  const inviteLabel = invite
    ? {
        awaiting_domain: labels.inviteAwaitingDomain,
        unsent: labels.inviteUnsent,
        sent: labels.inviteSent,
        accepted: labels.inviteAccepted,
        expired: labels.inviteExpired,
        refused: labels.inviteRefused,
      }[invite.status]
    : null;

  return (
    <div className="grid items-start gap-4 md:grid-cols-2">
      <Card className="flex flex-col gap-3 p-4 md:p-6" data-testid="invite-card">
        <SectionTitle variant="micro">{labels.inviteTitle}</SectionTitle>
        {invite && inviteLabel ? (
          <>
            <span className="break-all text-sm font-bold text-text">{invite.email}</span>
            <div>
              <StatusPill tone={inviteTone[invite.status]} className="whitespace-normal">
                {inviteLabel}
              </StatusPill>
            </div>
            {resend}
          </>
        ) : (
          <p className="text-sm text-text-secondary">{labels.noInvite}</p>
        )}
      </Card>

      <Card className="flex flex-col p-4 md:p-6" data-testid="admins-card">
        <SectionTitle variant="micro" className="mb-3">
          {labels.adminsTitle}
        </SectionTitle>
        {admins.length === 0 ? (
          <p className="flex min-h-14 items-center text-sm text-text-secondary">{labels.empty}</p>
        ) : (
          <ul className="-mx-4 md:-mx-6">
            {admins.map((admin) => (
              <li
                key={admin.userId}
                className="flex min-h-14 items-center gap-3 border-b border-divider px-4 py-2 last:border-0 md:px-6"
              >
                <Avatar size="sm" alt={admin.name || admin.email} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="break-all text-sm font-bold text-text">
                    {admin.name || admin.email}
                  </span>
                  <span className="break-all text-xs text-text-tertiary">{admin.email}</span>
                </div>
                <StatusPill tone="brand">{labels.role}</StatusPill>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
