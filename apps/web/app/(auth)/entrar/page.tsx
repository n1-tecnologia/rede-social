import { cookies } from 'next/headers';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { env } from '@/lib/env';
import { getHostBrand } from '@/lib/host-brand';
import { signupPath } from '@/lib/tenant-host';
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
  /** D-32: the host tenant is suspended — the form is replaced by the "indisponível" card. */
  suspended: boolean;
  /** E06 populated: with a logo in the brand block the "Entrar" title drops to 16/700 secondary. */
  hasLogo: boolean;
};

// `GET /v1/public/tenants/{slug}` now exists (01-04). Kept deliberately loose and non-fatal: any
// non-2xx or unparsable body simply means "no hint", never a broken login page.
const publicTenantSchema = z.object({ displayName: z.string() }).loose();

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
      suspended: brand.tenant?.status === 'suspended',
      hasLogo: brand.tenant !== null && hasLogo(brand),
    };
  }
  if (brand.mode === 'platform') {
    return { platform: true, tenantName: null, signupHref: null, suspended: false, hasLogo: false };
  }

  const slug = (await cookies()).get('tenant_slug')?.value;
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return {
      platform: false,
      tenantName: null,
      signupHref: null,
      suspended: false,
      hasLogo: false,
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
    suspended: false,
    hasLogo: false,
  };
}

export default async function EntrarPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const [{ erro }, t, tc, tp, tu, shell] = await Promise.all([
    searchParams,
    getTranslations('login'),
    getTranslations('common'),
    getTranslations('platform'),
    getTranslations('unavailable'),
    resolveShell(),
  ]);

  return (
    <>
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

      {shell.suspended ? (
        // D-32: nothing else renders on a suspended host — no form, no forgot link, no sign-up CTA.
        <UnavailableCard title={tu('title')} body={tu('body')} />
      ) : (
        <>
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
