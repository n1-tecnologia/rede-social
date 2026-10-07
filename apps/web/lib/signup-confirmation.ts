import { mailReturnOrigin } from '@/lib/mail-return-origin';
import { createClient } from '@/lib/supabase/server';

/**
 * Asks GoTrue to (re)send the sign-up confirmation mail (quick 261007-gbk). GoTrue sends nothing on
 * the API's admin `createUser`, so the web tier triggers the mail with `auth.resend({ type: 'signup' })`:
 * GoTrue mints the token and calls the Send Email Hook, which brands and delivers it.
 *
 * The link comes back to the host the person used (`mailReturnOrigin`, the same host-poisoning guard
 * as the recovery mail); when the origin is refused nothing is sent. The result is NEVER inspected or
 * surfaced beyond a `console.warn` of the error code and status (never the e-mail, token or link):
 * any difference between "no such account", "already confirmed", "throttled" and "sent" would be an
 * account-enumeration oracle (T-gbk-01).
 */
export async function sendSignupConfirmation(email: string): Promise<void> {
  const origin = await mailReturnOrigin('signup_confirmation.origin_refused');
  if (!origin) return;

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=/inicio` },
  });
  if (error) {
    console.warn('signup_confirmation.resend_failed', { code: error.code, status: error.status });
  }
}
