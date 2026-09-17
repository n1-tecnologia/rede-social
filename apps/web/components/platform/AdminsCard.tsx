import { Avatar, Card, SectionTitle, StatusPill } from '@tria/ui';
import type { ReactNode } from 'react';

export type InviteView = {
  email: string;
  /**
   * The contract's four statuses plus `refused` — a view-only state derived by the page from
   * `status === 'expired' && sentAt === null` (a refused first-admin e-mail, 02-19 D-A); the API
   * contract has no such status and never learns of it.
   */
  status: 'pending' | 'sent' | 'accepted' | 'expired' | 'refused';
  /** Pre-formatted on the server (`formatPanelDate(sentAt, 'dateTime')`). */
  sentAtLabel: string | null;
  /** Pre-formatted on the server (`formatPanelDate(acceptedAt)`). */
  acceptedAtLabel: string | null;
};

export type AdminView = { userId: string; name: string; email: string };

export interface AdminsCardLabels {
  inviteTitle: string;
  noInvite: string;
  invitePending: string;
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
   * The "Reenviar convite" control (D-30). 02-12 passes nothing; plan 02-10 mounts the outline
   * button + helper wired to `POST /v1/platform/tenants/{id}/invites/{inviteId}/resend`.
   */
  resend?: ReactNode;
}

const inviteTone = {
  pending: 'warning',
  sent: 'neutral',
  accepted: 'success',
  expired: 'danger',
  refused: 'danger',
} as const;

/**
 * Admins tab (D-29/D-30, mockup `tenant-page-admins`), server-safe (no hooks): the first-admin
 * invite card (e-mail + state pill + the typed resend slot) and the "Administradores" card listing
 * `admin_tenant` memberships. Long e-mails `break-all` at 12/14 px so a 60-character address never
 * overflows (E17 backstop); an admin without a profile name shows the e-mail in the name slot.
 */
export function AdminsCard({ invite, admins, labels, resend }: AdminsCardProps) {
  const inviteLabel = invite
    ? {
        pending: labels.invitePending,
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
