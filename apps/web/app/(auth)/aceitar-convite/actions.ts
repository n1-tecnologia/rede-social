'use server';

import {
  acceptInviteExistingFormSchema,
  acceptInviteFormSchema,
  inviteContextSchema,
} from '@rede-social/contracts';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';

/**
 * "Aceitar convite" (ROLE-03, D-29, D-10, D-03): Zod -> password through Supabase -> consents
 * through the API -> `/inicio`.
 *
 * The password NEVER reaches the API, a URL or a log: it is used exactly once, in the
 * `@supabase/ssr` client's `updateUser` (the same call `/redefinir-senha` makes), which needs the
 * session `/auth/confirm` created from the invite link. The API call carries the two consent
 * versions only.
 *
 * The order password -> accept is deliberate: a failure between the two leaves a RECOVERABLE state
 * (password set, membership still `invited`), so the admin can log in and `requireBootstrap()`
 * routes them back here — never stranded. Every target is computed first and `redirect()` is
 * always called outside try/catch (Next 16 rule).
 *
 * D-314: an identity that ALREADY has a password (a member of another community, invited with the
 * tokenless mail, signed in on `/entrar`) accepts without one. Which form applies is asked of the API
 * here, server-side (`GET /v1/me/invite`), never taken from the submitted form: a form edit can
 * neither skip the password for an identity without one nor force `updateUser` for one that has one
 * (T-08.1-30).
 */
export async function acceptInvite(formData: FormData): Promise<void> {
  let contextTarget: string | null = null;
  let passwordRequired = true;
  try {
    const res = await apiFetch('/v1/me/invite');
    if (res.ok) {
      const context = inviteContextSchema.safeParse(await res.json());
      if (context.success) passwordRequired = context.data.passwordRequired;
      else contextTarget = '/aceitar-convite?erro=falha';
    } else if (res.status === 401 || res.status === 403) {
      contextTarget = '/convite-expirado';
    } else {
      contextTarget = '/aceitar-convite?erro=falha';
    }
  } catch {
    contextTarget = '/aceitar-convite?erro=falha';
  }
  if (contextTarget) redirect(contextTarget);

  const fields = {
    rulesVersion: Number(formData.get('rulesVersion')),
    termsVersion: Number(formData.get('termsVersion')),
    // Unchecked boxes are absent from the FormData entirely; `z.literal(true)` then fails (AUTH-04).
    acceptRules: formData.get('acceptRules') === 'on',
    acceptTerms: formData.get('acceptTerms') === 'on',
  };
  const withPassword = passwordRequired
    ? acceptInviteFormSchema.safeParse({
        ...fields,
        password: String(formData.get('password') ?? ''),
      })
    : null;
  const parsed = withPassword ?? acceptInviteExistingFormSchema.safeParse(fields);
  if (!parsed.success) {
    const invalid = [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? 'form'))),
    ];
    redirect(`/aceitar-convite?erro=validacao&campos=${encodeURIComponent(invalid.join(','))}`);
  }

  if (withPassword?.success) {
    // No session = the link was never exchanged (or it expired): the honest screen is the expired one.
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password: withPassword.data.password });
    if (error) redirect('/convite-expirado');
  }

  const requestHeaders = await headers();
  const forwarded = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim();
  const clientIp = requestHeaders.get('x-real-ip') ?? forwarded ?? '';
  const userAgent = requestHeaders.get('user-agent') ?? '';

  let target: string;
  try {
    const res = await apiFetch('/v1/me/accept-invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(clientIp ? { 'X-Client-IP': clientIp } : {}),
        ...(userAgent ? { 'User-Agent': userAgent } : {}),
      },
      body: JSON.stringify({
        rulesVersion: parsed.data.rulesVersion,
        termsVersion: parsed.data.termsVersion,
      }),
    });
    if (res.ok) target = '/inicio';
    else if (res.status === 401 || res.status === 403) target = '/convite-expirado';
    else if (res.status === 400) target = '/aceitar-convite?erro=consentimento';
    else target = '/aceitar-convite?erro=falha';
  } catch {
    target = '/aceitar-convite?erro=falha';
  }

  redirect(target);
}
