'use server';

import { loginSchema } from '@tria/contracts';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * E-mail + password login in the web tier (AUTH-02, D-07). `@supabase/ssr` writes the HttpOnly
 * session cookies; no token ever reaches the client. One generic error for every failure (T-02-05).
 * The action does not look at the host: a member of another tenant reaches `/inicio`, where the API
 * answers 403 TENANT_HOST_MISMATCH and plan 01-05 renders the host-mismatch screen (D-23).
 */
export async function login(formData: FormData): Promise<void> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) redirect('/entrar?erro=credenciais');

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) redirect('/entrar?erro=credenciais');

  redirect('/inicio');
}
