import type { PlatformTenantDetail } from '@rede-social/contracts';
import { getTranslations } from 'next-intl/server';
import { resendInviteAction } from '@/app/(platform)/plataforma/tenants/[id]/admins/actions';
import { formatPanelDate, primaryVerifiedHost } from '@/lib/platform';
import { AdminsCard, deriveInviteState } from './AdminsCard';
import { ResendInviteButton } from './ResendInviteButton';

/**
 * The admins panel (D-29/D-30): the first-admin invite (the newest `tenant_invites` row) and the
 * `admin_tenant` memberships. Dates are formatted here, on the server. Rendered by the tenant
 * page's Admins tab and by the tenant wizard's Pronto step.
 *
 * Where the invite stands comes from `deriveInviteState` (quick 260929-g0s) — the API already
 * returns `status`/`sentAt`/`acceptedAt` and the tenant's domains, so no contract field is added:
 * "Aguardando domínio verificado" while no verified primary host exists, "Convite ainda não enviado"
 * once one exists (the automatic `kernel.invite-send` job is queued, or failed after its retries),
 * "Enviado em <data/hora>", "Aceito em <data>", expired, and the refused state (02-19 D-A: `expired`
 * with `sentAt` null — the e-mail already has an identity on the platform).
 *
 * The control in `AdminsCard`'s slot is the same `ResendInviteButton` with two label sets: "Enviar
 * convite" while the invite was never mailed (pending, refused), "Reenviar convite" after a send
 * (sent, lapsed); none once accepted. It is disabled with the helper line whenever the tenant has no
 * verified primary host (the link must open the tenant's own origin, D-36). Both call the same
 * immediate resend route; after it the layout revalidates, so the pill shows the new `sentAt`, and a
 * refusal toasts its reason from the catalog (WR-02/WR-03).
 */
export async function AdminsPanel({
  tenantId,
  detail,
}: {
  tenantId: string;
  detail: PlatformTenantDetail;
}) {
  const t = await getTranslations('platform');
  const raw = detail.invites[0] ?? null;
  const state = raw ? deriveInviteState(raw, primaryVerifiedHost(detail) !== null) : null;
  const invite =
    raw && state
      ? {
          email: raw.email,
          status: state.status,
          sentAtLabel: raw.sentAt ? formatPanelDate(raw.sentAt, 'dateTime') : null,
          acceptedAtLabel: raw.acceptedAt ? formatPanelDate(raw.acceptedAt) : null,
        }
      : null;

  const reasons = {
    email_in_use: t('admins.resendEmailInUse'),
    user_in_other_tenant: t('admins.resendUserInOtherTenant'),
  };
  const buttonLabels =
    state?.action === 'send'
      ? {
          resend: t('admins.send'),
          resendPending: t('admins.sendPending'),
          resendHelper: t('admins.resendHelper'),
          resent: t('admins.sent'),
          resendFailed: t('admins.sendFailed'),
          reasons,
        }
      : {
          resend: t('admins.resend'),
          resendPending: t('admins.resendPending'),
          resendHelper: t('admins.resendHelper'),
          resent: t('admins.resent'),
          resendFailed: t('admins.resendFailed'),
          reasons,
        };
  const resend =
    raw && state && state.action !== null ? (
      <ResendInviteButton
        tenantId={tenantId}
        inviteId={raw.id}
        canResend={state.canSend}
        labels={buttonLabels}
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
        inviteAwaitingDomain: t('admins.inviteAwaitingDomain'),
        inviteUnsent: t('admins.inviteUnsent'),
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
