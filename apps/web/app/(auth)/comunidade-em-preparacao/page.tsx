import { EmptyState } from '@rede-social/ui';
import { Hourglass } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { LinkButton } from '../LinkButton';

/**
 * "Comunidade em preparação" (09.2-21, UI-D-542, D-535, D-542). Reached through
 * `bootstrapRedirectPath` when the API answers `TENANT_PREPARING`, and directly by anyone on a host
 * whose community is still being prepared. The `(auth)` layout still resolves the host, so the screen
 * is branded.
 *
 * Nothing clears the session. The single action is a plain link to `/inicio`, which lands back here
 * while the state holds and on the app once it clears (idempotent: no cookie, no body).
 *
 * Copy: `preparing.*` (pt-BR catalog). This component takes NO props and reads no cookie, no header
 * and no search param, and it has NO timer, auto-refresh or countdown (A-UI-7): no reason, no time,
 * no tenant name beyond what the host brand already shows. Keep it that way.
 */
export default async function ComunidadeEmPreparacaoPage() {
  const t = await getTranslations('preparing');

  return (
    <div className="w-full">
      <EmptyState
        icon={Hourglass}
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
