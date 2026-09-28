import { EmptyState } from '@rede-social/ui';
import { ShieldOff } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { LinkButton } from '../LinkButton';

/**
 * "Acesso suspenso" (AUTH-06, D-09). Reached only through `/auth/blocked`, which has already cleared
 * the session; a later login succeeds at Supabase level, lands on `/inicio`, gets the same 403 and
 * comes back here with no extra code.
 *
 * Copy: `suspended.title` / `suspended.body` (pt-BR catalog).
 * The ONLY tenant-specific datum on this screen is the display name, echoed from the 403's
 * `details.tenantName` as a React text node. No reason, no moderator, no timestamp, no appeal channel
 * beyond "Fale com a equipe." — a suspension message must never become a moderation disclosure.
 */
export default async function AcessoSuspensoPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const [{ t: tenantParam }, t, tc] = await Promise.all([
    searchParams,
    getTranslations('suspended'),
    getTranslations('common'),
  ]);
  const tenant = tenantParam?.trim() || 'sua comunidade';

  return (
    <div className="w-full">
      <EmptyState
        icon={ShieldOff}
        title={t('title')}
        body={t('body', { tenant })}
        action={
          <LinkButton href="/entrar" variant="outline" size="lg" fullWidth>
            {tc('back')}
          </LinkButton>
        }
      />
    </div>
  );
}
