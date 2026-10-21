import { Button, buttonClasses, EmptyState } from '@rede-social/ui';
import { CreditCard, ExternalLink } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { logout } from '@/app/(app)/actions';
import { LogoutForm } from '@/components/shell/LogoutForm';
import { getSubscriptionStatus, safeCheckoutUrl } from '@/lib/subscription';
import { LinkButton } from '../LinkButton';

/**
 * "Sua assinatura não está ativa" (09.1-15, UI-D-521, D-496, D-497, D-499; PAY-14, PAY-15). Where a
 * signed-in member lands when `requireAuth` answers 403 `SUBSCRIPTION_PENDING`: from a fresh page
 * (`bootstrapRedirectPath`), from an open app nudged by the cut (`LiveShell`), or from a join / Membros
 * action. It lives in the `(auth)` group, so the layout paints the host brand with no TopBar, rail or
 * BottomNav. Never statically rendered (the read below carries the session).
 *
 * **The session is kept (D-499).** Unlike `/auth/blocked` and `/acesso-suspenso`, nothing here signs out,
 * forgets a push subscription or writes a cookie: the Supabase identity is shared across communities, so
 * only "Sair" ends it, through the shipped `LogoutForm` (which forgets this device's push first). This
 * module deliberately imports no Supabase client, no `next/headers` and no push-forgetting component.
 *
 * **The checkout link has one reader (UI-D-532, T-09.1-70).** `getSubscriptionStatus()` asks
 * `GET /v1/me/subscription` (the one route a cut member can reach) per request, and `safeCheckoutUrl`
 * offers the pay button only for an `https:` URL. The tenant name and the link are NEVER read from the URL:
 * the `?t=` the redirect carries is only the fallback name while that read fails (E08 error), rendered as
 * a React text node. The screen names no other community (D-302) and says nothing about suspension,
 * blocking or moderation: the member has done nothing wrong, so it says what happens next and offers the
 * one thing that fixes it.
 *
 * Stateless and idempotent (P28): reloading, tapping "Verificar de novo" twice, or a second device all
 * behave the same; while access is still cut, `/inicio` answers 403 and sends the member straight back
 * here with no write and no loop.
 */
export default async function SubscriptionPendingPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const [{ t: tenantParam }, status, t, tApp] = await Promise.all([
    searchParams,
    getSubscriptionStatus(),
    getTranslations('payments'),
    getTranslations('app'),
  ]);

  const checkoutUrl = safeCheckoutUrl(status?.checkoutUrl);
  const tenant = status?.tenantName.trim() || tenantParam?.trim() || t('pending.tenantFallback');
  // Without a safe link (none registered, or the read failed) the body ends by pointing at the team.
  const body = checkoutUrl
    ? t('pending.body')
    : `${t('pending.body')} ${t('pending.bodyNoLink', { tenant })}`;

  return (
    // `overflow-wrap` is inherited: a long tenant name in the body wraps inside the frame (E08 long-text).
    <div className="flex w-full flex-col gap-6 break-words [&>div:first-child>div]:pb-0">
      <EmptyState icon={CreditCard} title={t('pending.title')} body={body} />
      <div className="flex w-full flex-col gap-2">
        {checkoutUrl ? (
          <a
            href={checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClasses({ variant: 'brand', size: 'lg', fullWidth: true })}
          >
            <ExternalLink aria-hidden size={18} />
            {t('pending.pay')}
            <span className="sr-only"> {t('pending.newTab')}</span>
          </a>
        ) : null}
        <LinkButton href="/inicio" variant="outline" size="lg" fullWidth>
          {t('pending.retry')}
        </LinkButton>
        {/* "Sair" is the shipped settings label (`app.logout`). F-1: neutral ink, as drawn and as the
            UI-SPEC lists it (the shipped ghost button paints brand ink). */}
        <LogoutForm action={logout} className="w-full">
          <Button type="submit" variant="ghost" size="lg" fullWidth className="text-text-secondary">
            {tApp('logout')}
          </Button>
        </LogoutForm>
      </div>
    </div>
  );
}
