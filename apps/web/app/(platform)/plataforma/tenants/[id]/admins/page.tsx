import { getTranslations } from 'next-intl/server';
import { AdminsCard } from '@/components/platform/AdminsCard';
import { ResendInviteButton } from '@/components/platform/ResendInviteButton';
import { formatPanelDate, primaryVerifiedHost, requirePlatformTenantDetail } from '@/lib/platform';
import { resendInviteAction } from './actions';

/**
 * Admins tab (D-29/D-30): the first-admin invite (the newest `tenant_invites` row) and the
 * `admin_tenant` memberships. Dates are formatted here, on the server. The "Reenviar convite"
 * control (02-10) fills `AdminsCard`'s `resend` slot: a `pending` invite can be resent once a
 * verified primary host exists (the API delegates to the first send) — without one the button is
 * disabled with the helper line; an `accepted` invite renders no control at all. After a resend the
 * layout revalidates, so the "Convite enviado em {date}" pill shows the new `sentAt`. A refused
 * invite (02-19 D-A: `expired` with `sentAt` null — the e-mail already has an identity on the
 * platform) is derived HERE into the view-only `refused` state so the pill names the cause instead
 * of "Convite expirado"; it keeps the resend control (`canResend` stays true for a non-pending
 * row) and the resend toast names the reason from the catalog (WR-02/WR-03).
 */
export default async function TenantAdminsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, detail] = await Promise.all([
    getTranslations('platform'),
    requirePlatformTenantDetail(id),
  ]);
  const raw = detail.invites[0] ?? null;
  const invite = raw
    ? {
        email: raw.email,
        status: raw.status === 'expired' && raw.sentAt === null ? ('refused' as const) : raw.status,
        sentAtLabel: raw.sentAt ? formatPanelDate(raw.sentAt, 'dateTime') : null,
        acceptedAtLabel: raw.acceptedAt ? formatPanelDate(raw.acceptedAt) : null,
      }
    : null;

  const canResend = raw?.status === 'pending' ? primaryVerifiedHost(detail) !== null : true;
  const resend =
    raw && raw.status !== 'accepted' ? (
      <ResendInviteButton
        tenantId={id}
        inviteId={raw.id}
        canResend={canResend}
        labels={{
          resend: t('admins.resend'),
          resendPending: t('admins.resendPending'),
          resendHelper: t('admins.resendHelper'),
          resent: t('admins.resent'),
          resendFailed: t('admins.resendFailed'),
          reasons: {
            email_in_use: t('admins.resendEmailInUse'),
            user_in_other_tenant: t('admins.resendUserInOtherTenant'),
          },
        }}
        action={resendInviteAction}
      />
    ) : undefined;

  return (
    <AdminsCard
      invite={invite}
      resend={resend}
      admins={detail.admins.map((a) => ({ userId: a.userId, name: a.name, email: a.email }))}
      labels={{
        inviteTitle: t('admins.inviteTitle'),
        noInvite: t('admins.noInvite'),
        invitePending: t('admins.invitePending'),
        inviteSent: t('admins.inviteSent', { date: invite?.sentAtLabel ?? '' }),
        inviteAccepted: t('admins.inviteAccepted', { date: invite?.acceptedAtLabel ?? '' }),
        inviteExpired: t('admins.inviteExpired'),
        inviteRefused: t('admins.inviteRefused'),
        adminsTitle: t('admins.adminsTitle'),
        role: t('admins.role'),
        empty: t('admins.empty'),
      }}
    />
  );
}
