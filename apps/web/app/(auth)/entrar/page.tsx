import { cookies } from 'next/headers';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { RearmProfileNudge } from '@/components/profile/RearmProfileNudge';
import { ForgetSignedOutDevice } from '@/components/push/ForgetSignedOutDevice';
import { env } from '@/lib/env';
import { type Held, heldIcon, heldNamespace, heldOf } from '@/lib/held-out';
import { getHostBrand } from '@/lib/host-brand';
import { createClient } from '@/lib/supabase/server';
import { signupPath } from '@/lib/tenant-host';
import { AccessNotice } from '../AccessNotice';
import { hasLogo } from '../AuthBrand';
import { AuthInput } from '../AuthInput';
import { LinkButton } from '../LinkButton';
import { SubmitButton } from '../SubmitButton';
import { UnavailableCard } from '../UnavailableCard';
import { login } from './actions';

type Shell = {
  platform: boolean;
  /** Tenant display name to show as "Comunidade: {tenant}" (null = no hint). */
  tenantName: string | null;
  /** Where "Criar nova conta" points (null = link hidden). */
  signupHref: string | null;
  /**
   * D-32, 09.2-21 (UI-D-542): the host tenant is suspended, paused or unreachable, being updated or still
   * being prepared — the form is replaced by that state's card (null = the form shows).
   */
  held: Held | null;
  /** E06 populated: with a logo in the brand block the "Entrar" title drops to 16/700 secondary. */
  hasLogo: boolean;
  /**
   * 09.1-15: the HOST tenant's slug, on a tenant host only (null on a generic or platform host, where
   * there is no community to name). It selects whose checkout link the no-access notice may show.
   */
  tenantSlug: string | null;
};

// `GET /v1/public/tenants/{slug}` now exists (01-04). Kept deliberately loose and non-fatal: any
// non-2xx or unparsable body simply means "no hint", never a broken login page.
const publicTenantSchema = z
  .object({ displayName: z.string(), accessCheckoutUrl: z.string().nullable().optional() })
  .loose();

/**
 * What the public shell shows, by host mode (D-21/D-22):
 * - tenant host: the host tenant's name, status and logo from the by-host answer (`getHostBrand`),
 *   sign-up at /cadastro
 * - generic host: the `tenant_slug` cookie (set by /cadastro/{slug}) selects the hint and the link (D-06)
 * - platform host: platform title, no hint, no member sign-up
 */
async function resolveShell(): Promise<Shell> {
  const brand = await getHostBrand();
  if (brand.mode === 'tenant') {
    return {
      platform: false,
      tenantName: brand.displayName,
      signupHref: signupPath(brand, ''),
      held: heldOf(brand.tenant?.status),
      hasLogo: brand.tenant !== null && hasLogo(brand),
      tenantSlug: brand.tenant?.slug ?? null,
    };
  }
  if (brand.mode === 'platform') {
    return {
      platform: true,
      tenantName: null,
      signupHref: null,
      held: null,
      hasLogo: false,
      tenantSlug: null,
    };
  }

  const slug = (await cookies()).get('tenant_slug')?.value;
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return {
      platform: false,
      tenantName: null,
      signupHref: null,
      held: null,
      hasLogo: false,
      tenantSlug: null,
    };
  }
  let tenantName: string | null = null;
  try {
    const res = await fetch(`${env.API_URL}/v1/public/tenants/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    if (res.ok) {
      const parsed = publicTenantSchema.safeParse(await res.json());
      if (parsed.success) tenantName = parsed.data.displayName;
    }
  } catch {
    // Never fail the login page over a hint.
  }
  return {
    platform: false,
    tenantName,
    signupHref: signupPath(brand, slug),
    held: null,
    hasLogo: false,
    tenantSlug: null,
  };
}

/**
 * 09.1-15 (UI-D-522, UI-D-532): the host tenant's stored `https:` checkout link for the no-access notice,
 * read from the public tenant record by the HOST's slug and ONLY on the error path. `null` on a generic or
 * platform host (no community), on any non-2xx, unparsable answer or transport failure: the notice then
 * shows the sentence alone. Never taken from the URL.
 */
async function noticeCheckoutUrl(slug: string | null): Promise<string | null> {
  if (!slug) return null;
  try {
    const res = await fetch(`${env.API_URL}/v1/public/tenants/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const parsed = publicTenantSchema.safeParse(await res.json());
    return parsed.success ? (parsed.data.accessCheckoutUrl ?? null) : null;
  } catch {
    return null;
  }
}

export default async function EntrarPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const [{ erro }, t, tc, tp, tu, tUpdating, tPreparing, ts, shell, claims] = await Promise.all([
    searchParams,
    getTranslations('login'),
    getTranslations('common'),
    getTranslations('platform'),
    getTranslations('unavailable'),
    getTranslations('updating'),
    getTranslations('preparing'),
    getTranslations('signup'),
    resolveShell(),
    createClient().then((supabase) => supabase.auth.getClaims()),
  ]);
  // 07 review C-WR-06: on this device nobody is signed in, so a push subscription left by a session
  // that ended without "Sair" is forgotten. A signed-in visit keeps its subscription.
  const signedOut = !claims.data?.claims;
  const heldCopy = {
    unavailable: { title: tu('title'), body: tu('body') },
    updating: { title: tUpdating('title'), body: tUpdating('body') },
    preparing: { title: tPreparing('title'), body: tPreparing('body') },
  };
  // 09.1-15: the notice's link is read only when the notice shows, never on a plain visit.
  const checkoutUrl = erro === 'nao-liberado' ? await noticeCheckoutUrl(shell.tenantSlug) : null;

  return (
    <>
      {signedOut ? <ForgetSignedOutDevice /> : null}
      {shell.tenantName ? (
        // D-22: the display-name line of the login page (also the carrier of the E06 long-name case).
        <p className="break-words text-center text-sm text-text-secondary">
          {t('tenantHint', { tenant: shell.tenantName })}
        </p>
      ) : null}
      <h1
        className={
          shell.hasLogo
            ? 'text-center text-base font-bold text-text-secondary'
            : 'text-center text-2xl font-bold tracking-[-0.02em] text-text'
        }
      >
        {shell.platform ? tp('loginTitle') : t('title')}
      </h1>

      {shell.held ? (
        // D-32, UI-D-542: nothing else renders on a held-out host — no form, no forgot link, no sign-up
        // CTA. Suspended and unreachable share the generic sentence (A-UI-8); updating and preparing
        // have their own, with their own glyph.
        <UnavailableCard
          title={heldCopy[heldNamespace(shell.held)].title}
          body={heldCopy[heldNamespace(shell.held)].body}
          icon={heldIcon(shell.held)}
        />
      ) : (
        <>
          {erro === 'nao-liberado' ? (
            // Quick 261018-owq: the allowlist refusal (login or a mail link), now the one-sentence notice
            // of 09.1-15 above the form (UI-D-522); the form stays.
            <AccessNotice
              message={t('notAllowed')}
              subscribeLabel={ts('accessSubscribe')}
              newTabLabel={ts('accessNewTab')}
              checkoutUrl={checkoutUrl}
            />
          ) : null}
          <form action={login} className="flex flex-col gap-4">
            <AuthInput
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              icon="mail"
              placeholder={t('email')}
              aria-label={t('email')}
            />
            <AuthInput
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              icon="lock"
              placeholder={t('password')}
              aria-label={t('password')}
            />

            {erro === 'credenciais' ? (
              // T-02-05: ONE generic line, the only alert on the page.
              <p role="alert" className="text-center text-sm text-danger">
                {t('invalid')}
              </p>
            ) : null}

            {/* A sign-in starts a new visit: SUBMITTING makes the "Complete seu perfil" popup due
                again on Início. This page merely shown, as Back from Início shows it, re-arms
                nothing. */}
            <RearmProfileNudge />
            <SubmitButton label={t('submit')} pendingLabel={t('pending')} />

            <Link href="/esqueci-senha" className="text-center text-sm font-bold text-brand">
              {t('forgot')}
            </Link>
          </form>

          {shell.signupHref ? (
            <>
              <div className="flex w-full items-center gap-4">
                <span className="h-px flex-1 bg-border" />
                <span aria-hidden="true" className="text-sm text-text-tertiary">
                  {tc('or')}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <LinkButton href={shell.signupHref} variant="outline" size="lg" fullWidth>
                {t('createAccount')}
              </LinkButton>
            </>
          ) : null}
        </>
      )}
    </>
  );
}
