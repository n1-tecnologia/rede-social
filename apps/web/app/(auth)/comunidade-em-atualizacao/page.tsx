import { EmptyState } from '@rede-social/ui';
import { RefreshCw } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { LinkButton } from '../LinkButton';

/**
 * "Comunidade em atualização" (09.2-21, UI-D-542, D-535, D-545). Reached through
 * `bootstrapRedirectPath` when the API answers `TENANT_UPDATING`, and directly by anyone on a host
 * whose community is being updated. The `(auth)` layout still resolves the host, so the screen is
 * branded.
 *
 * Unlike `/auth/suspended` nothing clears the session: nothing was decided about this member, and a
 * migration is not a logout. The single action is a plain link to `/inicio`, which lands back here
 * while the state holds and on the app once it clears (idempotent: no cookie, no body, no session
 * created by pressing it).
 *
 * Copy: `updating.*` (pt-BR catalog). This component takes NO props and reads no cookie, no header
 * and no search param, and it has NO timer, auto-refresh or countdown (A-UI-7): no reason, no time,
 * no tenant name beyond what the host brand already shows. Keep it that way.
 */
export default async function ComunidadeEmAtualizacaoPage() {
  const t = await getTranslations('updating');

  return (
    <div className="w-full">
      <EmptyState
        icon={RefreshCw}
        title={t('title')}
        body={t('body')}
        action={
          <LinkButton href="/inicio" variant="outline" size="lg" fullWidth>
            {t('retry')}
          </LinkButton>
        }
      />
    </div>
  );
}
