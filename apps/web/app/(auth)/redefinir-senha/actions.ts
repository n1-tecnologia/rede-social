'use server';

import { resetSchema } from '@tria/contracts';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * "Redefinir senha" (AUTH-03, D-10). The path is public, but this action only succeeds with the session
 * `/auth/confirm` created from the e-mail's one-time token: `updateUser` needs it. Setting the password
 * therefore also signs the person in, which is exactly what D-10 asks for — hence `redirect('/inicio')`.
 *
 * Every failure (no session, expired link, password below the 8-character minimum that Zod and
 * `minimum_password_length` both enforce) funnels back to `/esqueci-senha?erro=link-invalido`, the one
 * screen that can hand out a new link.
 */
export async function reset(formData: FormData): Promise<void> {
  const parsed = resetSchema.safeParse({ password: formData.get('password') });
  if (!parsed.success) redirect('/esqueci-senha?erro=link-invalido');

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) redirect('/esqueci-senha?erro=link-invalido');

  redirect('/inicio');
}
