import { getTranslations } from 'next-intl/server';
import { AdminsCard } from '@/components/platform/AdminsCard';
import { formatPanelDate, requirePlatformTenantDetail } from '@/lib/platform';

/**
 * Admins tab (D-29/D-30): the first-admin invite (the newest `tenant_invites` row) and the
 * `admin_tenant` memberships. Dates are formatted here, on the server. The "Reenviar convite"
 * control is the `resend` slot plan 02-10 fills (this page passes nothing).
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
        status: raw.status,
        sentAtLabel: raw.sentAt ? formatPanelDate(raw.sentAt, 'dateTime') : null,
        acceptedAtLabel: raw.acceptedAt ? formatPanelDate(raw.acceptedAt) : null,
      }
    : null;

  return (
    <AdminsCard
      invite={invite}
      admins={detail.admins.map((a) => ({ userId: a.userId, name: a.name, email: a.email }))}
      labels={{
        inviteTitle: t('admins.inviteTitle'),
        noInvite: t('admins.noInvite'),
        invitePending: t('admins.invitePending'),
        inviteSent: t('admins.inviteSent', { date: invite?.sentAtLabel ?? '' }),
        inviteAccepted: t('admins.inviteAccepted', { date: invite?.acceptedAtLabel ?? '' }),
        inviteExpired: t('admins.inviteExpired'),
        adminsTitle: t('admins.adminsTitle'),
        role: t('admins.role'),
        empty: t('admins.empty'),
      }}
    />
  );
}
