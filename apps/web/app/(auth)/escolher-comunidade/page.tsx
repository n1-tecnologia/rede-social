import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getHostTenant } from '@/lib/tenant-host';
import { declineJoin } from '../participar/actions';
import { chooseCommunity } from './actions';
import { loadCommunities } from './load';

/**
 * "Escolha a comunidade" (08.1-03, D-308; UI-SPEC UI-D-322): the GENERIC-host picker (localhost,
 * Vercel Preview) for an identity with more than one selectable membership. Reached when the bootstrap
 * answers TENANT_CHOICE_REQUIRED, or opened directly to switch. NOT public in `proxy.ts`: without a
 * session it falls through to `/entrar`. Never statically rendered (cookies through `apiFetch`).
 *
 * D-309 / D-21: a tenant or the platform host renders the not-found screen BEFORE any fetch — a tenant
 * app never lists, links or names the person's other communities (the API answers 404 there too).
 *
 * The list is `GET /v1/join/communities`: the caller's own non-deleted, non-blocked memberships,
 * ordered by display name (pt-BR) then slug. One form per community posts its slug to
 * `chooseCommunity`, which re-reads the list before storing the choice. The `(auth)` layout paints the
 * neutral platform brand here (a generic host carries no tenant brand).
 */
export default async function EscolherComunidadePage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const [{ erro }, hostTenant, t] = await Promise.all([
    searchParams,
    getHostTenant(),
    getTranslations('join'),
  ]);
  if (hostTenant.mode !== 'generic') notFound();

  const loaded = await loadCommunities();
  if (loaded.kind === 'unauthenticated') redirect('/entrar');
  if (loaded.kind === 'not_found') notFound();
  const { communities } = loaded;

  return (
    <>
      <h1 className="break-words text-center text-2xl font-bold tracking-[-0.02em] text-text">
        {t('picker.title')}
      </h1>
      <p className="text-center text-sm text-text-secondary">{t('picker.subtitle')}</p>

      {erro === 'invalida' ? (
        <p role="alert" className="text-center text-sm text-danger">
          {t('picker.invalid')}
        </p>
      ) : null}

      {communities.length === 0 ? (
        <p className="text-center text-sm text-text-secondary">{t('picker.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {communities.map((community) => (
            <li key={community.slug}>
              <form action={chooseCommunity}>
                <input type="hidden" name="slug" value={community.slug} />
                <button
                  type="submit"
                  className="flex min-h-11 w-full items-center justify-center break-words rounded-xl bg-bg-tertiary px-5 py-2.5 text-center text-sm font-bold text-text transition-colors hover:bg-bg-active active:bg-bg-tertiary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  {community.displayName}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {/* "Sair": a local-scope sign-out of THIS origin only, then `/entrar` (D-305). */}
      <form action={declineJoin} className="flex justify-center">
        <button
          type="submit"
          className="min-h-11 rounded-xl px-4 text-sm font-bold text-text-secondary transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          {t('picker.logout')}
        </button>
      </form>
    </>
  );
}
