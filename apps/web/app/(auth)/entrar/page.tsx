import { cookies } from 'next/headers';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { env } from '@/lib/env';
import { getHostTenant, signupPath } from '@/lib/tenant-host';
import { SubmitButton } from '../SubmitButton';
import { login } from './actions';

type Shell = {
  platform: boolean;
  /** Tenant display name to show as "Comunidade: {tenant}" (null = no hint). */
  tenantName: string | null;
  /** Where "Criar nova conta" points (null = link hidden). */
  signupHref: string | null;
};

// `GET /v1/public/tenants/{slug}` now exists (01-04). Kept deliberately loose and non-fatal: any
// non-2xx or unparsable body simply means "no hint", never a broken login page.
const publicTenantSchema = z.object({ displayName: z.string() }).loose();

/**
 * What the public shell shows, by host mode (D-21/D-22):
 * - tenant host: the host tenant's name from the proxy headers (no cookie, no fetch), sign-up at /cadastro
 * - generic host: the `tenant_slug` cookie (set by /cadastro/{slug}) selects the hint and the link (D-06)
 * - platform host: platform title, no hint, no member sign-up
 */
async function resolveShell(): Promise<Shell> {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'tenant') {
    return {
      platform: false,
      tenantName: hostTenant.displayName,
      signupHref: signupPath(hostTenant, hostTenant.slug),
    };
  }
  if (hostTenant.mode === 'platform') return { platform: true, tenantName: null, signupHref: null };

  const slug = (await cookies()).get('tenant_slug')?.value;
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return { platform: false, tenantName: null, signupHref: null };
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
  return { platform: false, tenantName, signupHref: signupPath(hostTenant, slug) };
}

export default async function EntrarPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const [{ erro }, t, tc, tp, shell] = await Promise.all([
    searchParams,
    getTranslations('login'),
    getTranslations('common'),
    getTranslations('platform'),
    resolveShell(),
  ]);

  return (
    <>
      <h1>{shell.platform ? tp('loginTitle') : t('title')}</h1>
      {shell.tenantName ? <p>{t('tenantHint', { tenant: shell.tenantName })}</p> : null}
      {erro === 'credenciais' ? <p role="alert">{t('invalid')}</p> : null}

      <form action={login} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <label htmlFor="email">{t('email')}</label>
        <input id="email" name="email" type="email" autoComplete="username" required />

        <label htmlFor="password">{t('password')}</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
        />

        <SubmitButton label={t('submit')} pendingLabel={t('pending')} />
      </form>

      <p>
        <Link href="/esqueci-senha">{t('forgot')}</Link>
      </p>

      {shell.signupHref ? (
        <>
          <p aria-hidden="true">{tc('or')}</p>
          <p>
            <Link href={shell.signupHref}>{t('createAccount')}</Link>
          </p>
        </>
      ) : null}
    </>
  );
}
