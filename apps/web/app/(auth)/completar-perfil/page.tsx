import type { MemberForm } from '@rede-social/contracts/profile-form';
import { Button, EmptyState } from '@rede-social/ui';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { logout } from '@/app/(app)/actions';
import { ProfileForm } from '@/components/profile-form/ProfileForm';
import { LogoutForm } from '@/components/shell/LogoutForm';
import {
  ApiClientError,
  bootstrapRedirectPath,
  getBootstrap,
  loadOrRedirect,
} from '@/lib/bootstrap';
import { getMemberForm } from '@/lib/profile-form/member-form';
import { safeNextPath } from '@/lib/safe-next-path';
import { LinkButton } from '../LinkButton';

/**
 * "Complete seu perfil" (12-12, D-580..D-584, UI-D-581, UI-D-588; PFORM-13, PFORM-14, PFORM-26). Where a
 * member lands when the profile-form gate answers 403 `PROFILE_FORM_PENDING` (`bootstrapRedirectPath`), from
 * "Minhas respostas" on the profile (edit mode) and from the notice of new optional questions. It lives in
 * the `(auth)` group, so the layout paints the host brand with no TopBar, rail or BottomNav. Never statically
 * rendered (the reads carry the session).
 *
 * **This page must not use the redirecting guard of the `(app)` pages (RESEARCH Pitfall 2).** That guard
 * sends a gated member to THIS route, so calling it here would redirect the page to itself. The page reads
 * the bootstrap through `getBootstrap` with `loadOrRedirect(..., bootstrapRedirectPath)` instead, which only
 * follows the session and membership refusals; `/v1/me/bootstrap` is on the gate's allow-list, so a gated
 * member still gets an answer. A unit test pins that the module source never names the guard.
 *
 * **One screen, three modes (UI-D-581).** The mode (`first`, `returning`, `edit`) comes from the API read,
 * never from the URL or a client flag, so a brand-new member and an old one with the same stored answers
 * see the identical screen. Only the role `member` is asked (D-584): a staff user who types the URL goes
 * to `/inicio` with no read of the form and no write.
 *
 * **The session is kept (D-581).** Nothing here signs out: "Sair" goes through the shipped `LogoutForm`
 * (which forgets this device's push first), so a failing read never traps the member. The tenant name
 * comes from the bootstrap; the `?t=` the redirect carries is only the fallback text. `?next=` is never
 * trusted here: it is handed to the save action, which validates it with `safeNextPath` (T-12-29).
 */
export default async function CompletePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; t?: string | string[] }>;
}) {
  const [params, t, tApp] = await Promise.all([
    searchParams,
    getTranslations('profileForm.member'),
    getTranslations('app'),
  ]);
  const next = typeof params.next === 'string' ? params.next : undefined;
  const nameParam = typeof params.t === 'string' ? params.t.trim() : '';

  const bootstrap = await loadOrRedirect(getBootstrap, bootstrapRedirectPath);
  // D-584: only a member is asked. A staff user who typed the URL is sent on, with no read of the form.
  if (bootstrap.membership.role !== 'member') redirect('/inicio');

  let form: MemberForm | null = null;
  let refusal: string | null = null;
  try {
    form = await getMemberForm();
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 401 || error.status === 403)) {
      refusal = bootstrapRedirectPath(error);
    }
    console.error('profile_form.load_failed', {
      status: error instanceof ApiClientError ? error.status : undefined,
    });
  }
  // Outside the try/catch: `redirect()` throws.
  if (refusal) redirect(refusal);

  const tenant = bootstrap.tenant.displayName.trim() || nameParam || t('tenantFallback');
  const safeNext = safeNextPath(next);

  const leave = (
    <LogoutForm action={logout} className="w-full">
      <Button type="submit" variant="ghost" size="lg" fullWidth className="text-text-secondary">
        {tApp('logout')}
      </Button>
    </LogoutForm>
  );

  // The read failed: a card, a retry and "Sair", so the member is never trapped.
  if (form === null) {
    const retry = safeNext
      ? `/completar-perfil?next=${encodeURIComponent(safeNext)}`
      : '/completar-perfil';
    return (
      <div className="flex w-full flex-col gap-6 break-words">
        <EmptyState
          variant="card"
          icon={CircleAlert}
          title={t('loadFailed.title')}
          body={t('loadFailed.body')}
          action={
            <LinkButton href={retry} variant="outline">
              {t('retry')}
            </LinkButton>
          }
        />
        {leave}
      </div>
    );
  }

  // Nothing to answer (the module is off, every question was archived): a member who typed the URL.
  if (form.mode === 'none') {
    return (
      <div className="flex w-full flex-col gap-6 break-words">
        <EmptyState
          variant="card"
          icon={CircleCheck}
          title={t('none.title')}
          body={t('none.body')}
          action={
            <LinkButton href="/inicio" variant="outline">
              {t('home')}
            </LinkButton>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6 break-words">
      <ProfileForm
        form={form}
        next={next}
        title={t(`${form.mode}.title`)}
        intro={form.mode === 'edit' ? t('edit.intro') : t(`${form.mode}.intro`, { tenant })}
      />
      {form.mode === 'edit' ? (
        <LinkButton href={safeNext ?? '/perfil'} variant="outline" size="lg" fullWidth>
          {t('cancel')}
        </LinkButton>
      ) : (
        leave
      )}
    </div>
  );
}
