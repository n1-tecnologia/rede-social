'use server';

import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getHostTenant, TENANT_SLUG_COOKIE, TENANT_SLUG_MAX_AGE_S } from '@/lib/tenant-host';
import { loadCommunities } from './load';

/**
 * A community chosen on `/escolher-comunidade` (08.1-03, D-308; UI-SPEC UI-D-322). Generic hosts only:
 * on a tenant or the platform host the picker does not exist (D-309, D-21).
 *
 * The submitted `slug` is a form value the browser controls, so the list is RE-READ from the API and a
 * slug outside it is refused with `?erro=invalida` before anything is written (T-08.1-22). A listed slug
 * is stored in the `tenant_slug` cookie with exactly the attributes `proxy.ts` uses (HttpOnly,
 * SameSite=Lax, path `/`, one year); from then on `lib/api.ts` forwards it as `x-tenant-choice` and
 * the API selects that membership — still only among the caller's own (T-08.1-19).
 *
 * Every target is decided first and `redirect()` / `notFound()` are never inside a try/catch (Next 16).
 */
export async function chooseCommunity(formData: FormData): Promise<void> {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode !== 'generic') notFound();

  const slug = String(formData.get('slug') ?? '');
  const loaded = await loadCommunities();
  if (loaded.kind === 'unauthenticated') redirect('/entrar');
  if (loaded.kind === 'not_found') notFound();
  if (!loaded.communities.some((community) => community.slug === slug)) {
    redirect('/escolher-comunidade?erro=invalida');
  }

  (await cookies()).set(TENANT_SLUG_COOKIE, slug, {
    maxAge: TENANT_SLUG_MAX_AGE_S,
    sameSite: 'lax',
    path: '/',
    httpOnly: true,
  });
  redirect('/inicio');
}
