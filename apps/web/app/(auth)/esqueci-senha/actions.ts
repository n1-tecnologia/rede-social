'use server';

import { forgotSchema } from '@rede-social/contracts';
import { redirect } from 'next/navigation';
import { mailReturnOrigin } from '@/lib/mail-return-origin';
import { createClient } from '@/lib/supabase/server';

/**
 * "Recuperar senha" (AUTH-03, D-10). The answer is CONSTANT: whether the address exists, is
 * malformed, the origin was refused, or the mailer failed, the browser always lands on `?enviado=1`
 * and reads "Se existir uma conta com este e-mail, enviamos um link." — no account enumeration
 * (T-05-02). That is why this function has exactly ONE redirect target and never inspects the
 * Supabase result. The origin the link comes back to is `mailReturnOrigin` (host-poisoning guard,
 * WR-09, shared with the sign-up confirmation mail).
 */
export async function forgot(formData: FormData): Promise<void> {
  const parsed = forgotSchema.safeParse({ email: formData.get('email') });

  if (parsed.success) {
    const origin = await mailReturnOrigin('forgot.origin_refused');
    if (origin) {
      const supabase = await createClient();
      await supabase.auth.resetPasswordForEmail(parsed.data.email, {
        redirectTo: `${origin}/auth/confirm?next=/redefinir-senha`,
      });
    }
  }

  redirect('/esqueci-senha?enviado=1');
}
