import { EmptyState } from '@rede-social/ui';
import { MailX } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { LinkButton } from '../LinkButton';

/**
 * "Convite expirado" (ROLE-03, D-29 discretion; approved mockup `expired-invite`). Reached from
 * `/auth/confirm` when an invite link is expired, already consumed or superseded by a resend, and
 * from the accept action when no session exists. The `(auth)` layout still resolves the host, so the
 * screen is branded.
 *
 * Copy: `acceptInvite.expired.*` (pt-BR catalog). This component takes NO props and reads no cookie,
 * no header and no search param — by design: no tenant name, no e-mail, no reason beyond what the
 * host brand already shows (T-02-127). Exactly one outline CTA back to login. Keep it that way.
 */
export default async function ConviteExpiradoPage() {
  const t = await getTranslations('acceptInvite');

  return (
    <div className="w-full">
      <EmptyState
        icon={MailX}
        title={t('expired.title')}
        body={t('expired.body')}
        action={
          <LinkButton href="/entrar" variant="outline" size="lg" fullWidth>
            {t('expired.back')}
          </LinkButton>
        }
      />
    </div>
  );
}
