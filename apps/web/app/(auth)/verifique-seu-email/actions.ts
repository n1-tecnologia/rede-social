'use server';

import { forgotSchema } from '@rede-social/contracts';
import { redirect } from 'next/navigation';
import {
  readPendingConfirmation,
  withinResendCooldown,
  writePendingConfirmation,
} from '@/lib/pending-confirmation';
import { sendSignupConfirmation } from '@/lib/signup-confirmation';

const PAGE = '/verifique-seu-email';

/**
 * "Reenviar e-mail" on the verification screen (quick 261007-gbk). The address is the pending cookie's
 * e-mail when there is one, else the typed one (validated like the recovery form; invalid goes back with
 * `?erro=email`).
 *
 * The answer never says whether an account exists (T-gbk-01): after a send the target is always
 * `?reenviado=1`, whatever GoTrue replied (`sendSignupConfirmation` swallows its result). A repeat click
 * inside the 60 s cooldown of THIS browser's own cookie short-circuits to `?aguarde=1` without calling
 * GoTrue; that notice depends only on the person's own cookie, so it discloses nothing about the account.
 * Exactly one outcome per branch, and `redirect()` is never inside a try/catch (Next 16).
 */
export async function resendConfirmation(formData: FormData): Promise<void> {
  const pending = await readPendingConfirmation();

  let email: string;
  if (pending) {
    email = pending.email;
  } else {
    const parsed = forgotSchema.safeParse({ email: formData.get('email') });
    if (!parsed.success) redirect(`${PAGE}?erro=email`);
    email = parsed.data.email;
  }

  if (pending && withinResendCooldown(pending, Date.now())) redirect(`${PAGE}?aguarde=1`);

  await sendSignupConfirmation(email);
  await writePendingConfirmation({ email, sentAt: Date.now() });
  redirect(`${PAGE}?reenviado=1`);
}
