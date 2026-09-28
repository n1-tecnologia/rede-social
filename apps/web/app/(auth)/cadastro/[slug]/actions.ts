'use server';

import { signupFormSchema } from '@rede-social/contracts';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { getHostTenant, signupPath } from '@/lib/tenant-host';

/**
 * Sign-up (AUTH-01, AUTH-04, D-04): validate -> API (the only party allowed to bind an identity to a
 * tenant) -> sign in with the same credentials -> `/inicio`. No e-mail confirmation in the pilot.
 *
 * D-22: on a tenant domain the HOST decides the tenant and the hidden `slug` field is ignored, so a
 * forged slug in the form can never enrol someone in a foreign community (T-04-08). On generic hosts
 * the hidden field carries the D-01 slug the page was rendered for.
 *
 * The password is never logged and never placed in a URL.
 */
export async function signup(formData: FormData): Promise<void> {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/entrar');

  const formSlug = String(formData.get('slug') ?? '');
  const slug = hostTenant.mode === 'tenant' ? hostTenant.slug : formSlug;
  const base = signupPath(hostTenant, slug);

  const parsed = signupFormSchema.safeParse({
    name: String(formData.get('name') ?? ''),
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
    consents: {
      tenantRulesVersion: Number(formData.get('rulesVersion')),
      platformTermsVersion: Number(formData.get('termsVersion')),
    },
    // Unchecked boxes are absent from the FormData entirely; `z.literal(true)` then fails (AUTH-04).
    acceptRules: formData.get('acceptRules') === 'on',
    acceptTerms: formData.get('acceptTerms') === 'on',
  });
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? 'form'))),
    ];
    redirect(`${base}?erro=validacao&campos=${encodeURIComponent(fields.join(','))}`);
  }

  const { acceptRules: _acceptRules, acceptTerms: _acceptTerms, ...body } = parsed.data;

  const requestHeaders = await headers();
  const forwarded = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim();
  const clientIp = requestHeaders.get('x-real-ip') ?? forwarded ?? '';
  const userAgent = requestHeaders.get('user-agent') ?? '';

  const res = await fetch(`${env.API_URL}/v1/public/signup/${encodeURIComponent(slug)}`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(clientIp ? { 'X-Client-IP': clientIp } : {}),
      ...(userAgent ? { 'User-Agent': userAgent } : {}),
    },
    body: JSON.stringify(body),
  });

  if (res.status === 409) redirect(`${base}?erro=email-existente`);
  if (res.status === 404) notFound();
  if (!res.ok) redirect(`${base}?erro=validacao`);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  });
  // The account exists either way; sending the person to login is the only honest fallback.
  if (error) redirect('/entrar');

  redirect('/inicio');
}
