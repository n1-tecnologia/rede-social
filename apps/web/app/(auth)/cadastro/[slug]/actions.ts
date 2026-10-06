'use server';

import {
  apiErrorEnvelopeSchema,
  passwordSchema,
  signupFormSchema,
  slugSchema,
} from '@rede-social/contracts';
import { joinFormSchema } from '@rede-social/contracts/join';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { apiFetchWithToken } from '@/lib/api';
import { env } from '@/lib/env';
import { clearJoinDraft, readJoinDraft, writeJoinDraft } from '@/lib/join-draft';
import { createClient } from '@/lib/supabase/server';
import { getHostTenant, signupPath } from '@/lib/tenant-host';

/** The query that puts `/cadastro` into the "já tem conta" state (UI-D-321). Never carries the e-mail. */
const EXISTING_STATE = 'estado=ja-tem-conta';

/** The client's IP and user agent, forwarded to the API for its audit lines (never for decisions). */
async function clientHeaders(): Promise<Record<string, string>> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim();
  const clientIp = requestHeaders.get('x-real-ip') ?? forwarded ?? '';
  const userAgent = requestHeaders.get('user-agent') ?? '';
  return {
    ...(clientIp ? { 'X-Client-IP': clientIp } : {}),
    ...(userAgent ? { 'User-Agent': userAgent } : {}),
  };
}

/**
 * Sign-up (AUTH-01, AUTH-04, D-04): validate -> API (the only party allowed to bind an identity to a
 * tenant) -> sign in with the same credentials -> `/inicio`. No e-mail confirmation in the pilot.
 *
 * D-22: on a tenant domain the HOST decides the tenant and the hidden `slug` field is ignored, so a
 * forged slug in the form can never enrol someone in a foreign community (T-04-08). On generic hosts
 * the hidden field carries the D-01 slug the page was rendered for.
 *
 * D-301 / D-302: an e-mail that already has an identity (the API's detail-less 409) no longer ends in
 * an alert. The e-mail and the typed name go into the HttpOnly `join_draft` cookie (never the password,
 * never a URL) and the page turns into the "já tem conta" state, where `joinFromSignup` confirms the
 * EXISTING password. Nothing about where else the identity is a member is known or shown here.
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

  const res = await fetch(`${env.API_URL}/v1/public/signup/${encodeURIComponent(slug)}`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(await clientHeaders()) },
    body: JSON.stringify(body),
  });

  if (res.status === 409) {
    await writeJoinDraft({ email: body.email, name: body.name });
    redirect(`${base}?${EXISTING_STATE}`);
  }
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

/** Zod paths of the "já tem conta" form -> the `?campos=` tokens the page whitelists (T-02-49 rule). */
function fieldToken(path: readonly PropertyKey[]): string {
  const [head, leaf] = path.map(String);
  if (head === 'consents') return leaf === 'tenantRulesVersion' ? 'rulesVersion' : 'termsVersion';
  return head ?? 'form';
}

/**
 * "Participar" on the "já tem conta" state (08.1, D-301; UI-SPEC UI-D-321).
 *
 * 1. Host rules exactly as `signup`: the platform host never offers it, a tenant host decides the
 *    community (D-22), a generic host uses the hidden slug the page was rendered for.
 * 2. The draft cookie names the identity; without it the page shows the expired notice.
 * 3. The EXISTING password is proven with `signInWithPassword` on THIS origin. A wrong one goes back
 *    with `erro=senha` and nothing is written (D-301 step 4): the join endpoint is never called.
 * 4. `POST /v1/join` with the access token that sign-in just returned (`apiFetchWithToken`, RESEARCH
 *    Pitfall 5), carrying the name typed at sign-up (D-311) and the two consent versions shown (D-306).
 *    Whether the identity is already a member here, blocked here or a platform account surfaces only
 *    now, after the password (D-302).
 *
 * Every target is computed first and `redirect()` is called outside the try/catch (Next 16 rule).
 * Neither the e-mail, the name nor the password ever reaches a URL; only whitelisted field tokens do.
 */
export async function joinFromSignup(formData: FormData): Promise<void> {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/entrar');

  const formSlug = String(formData.get('slug') ?? '');
  const slug = hostTenant.mode === 'tenant' ? hostTenant.slug : formSlug;
  if (!slugSchema.safeParse(slug).success) notFound();
  const state = `${signupPath(hostTenant, slug)}?${EXISTING_STATE}`;

  const draft = await readJoinDraft();
  if (!draft) redirect(state);

  const password = String(formData.get('password') ?? '');
  const parsed = joinFormSchema.safeParse({
    name: draft.name,
    consents: {
      tenantRulesVersion: Number(formData.get('rulesVersion')),
      platformTermsVersion: Number(formData.get('termsVersion')),
    },
    // Unchecked boxes are absent from the FormData entirely; `z.literal(true)` then fails (AUTH-04).
    acceptRules: formData.get('acceptRules') === 'on',
    acceptTerms: formData.get('acceptTerms') === 'on',
  });
  const passwordOk = passwordSchema.safeParse(password).success;
  if (!parsed.success || !passwordOk) {
    const fields = new Set(
      parsed.success ? [] : parsed.error.issues.map((issue) => fieldToken(issue.path)),
    );
    if (!passwordOk) fields.add('password');
    redirect(`${state}&erro=validacao&campos=${encodeURIComponent([...fields].join(','))}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: draft.email,
    password,
  });
  // D-301 step 4: a wrong password writes nothing, and the answer never says more than "incorrect".
  if (error || !data.session) redirect(`${state}&erro=senha`);
  const accessToken = data.session.access_token;

  let target: string;
  let signOutLocally = false;
  try {
    const res = await apiFetchWithToken(accessToken, '/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await clientHeaders()) },
      body: JSON.stringify({
        name: parsed.data.name,
        consents: parsed.data.consents,
        ...(hostTenant.mode === 'generic' ? { slug } : {}),
      }),
    });
    if (res.ok) {
      // `joined` and `already_member` both enter: an existing member who "signs up" again simply
      // lands on Início, and the API wrote nothing for them.
      await clearJoinDraft();
      target = '/inicio';
    } else {
      const envelope = apiErrorEnvelopeSchema.safeParse(await res.json().catch(() => null));
      const apiError = envelope.success ? envelope.data.error : null;
      if (res.status === 403 && apiError?.code === 'MEMBERSHIP_BLOCKED') {
        // D-304: the blocked screen signs the session out itself.
        target = `/auth/blocked?t=${encodeURIComponent(String(apiError.details?.tenantName ?? ''))}`;
      } else if (res.status === 409 && apiError?.details?.reason === 'invite_pending') {
        target = '/aceitar-convite';
      } else if (res.status === 403 && apiError?.code === 'TENANT_SUSPENDED') {
        target = '/auth/suspended';
      } else if (res.status === 403 && apiError?.code === 'FORBIDDEN') {
        // A platform account (D-316) or a removed membership: the fresh session belongs to an origin
        // where this identity has no membership, so it is signed out here (T-08.1-16).
        signOutLocally = true;
        target = `${state}&erro=recusado`;
      } else if (res.status === 400 && apiError?.details?.consents === 'stale') {
        target = `${state}&erro=consentimento`;
      } else {
        target = `${state}&erro=falha`;
      }
    }
  } catch {
    target = `${state}&erro=falha`;
  }

  if (signOutLocally) {
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
    if (signOutError) console.error('signup.join_signout_failed', { error: String(signOutError) });
  }

  redirect(target);
}
