import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { EmptyState, PageHeader } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { LiveForm } from '@/app/(app)/cursos/lives/LiveForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { getLessonsForPicker, getLive } from '@/lib/courses';
import { getLearnLive } from '@/lib/courses-learn';
import { isPreview, MEMBER_LIVES_HREF } from '@/lib/courses-member-view';
import { liveFormDefaults } from '@/lib/courses-view';
import { communityAccessProductsView } from '@/lib/store-view';
import { MemberLivePage } from './MemberLivePage';

/**
 * `/cursos/lives/[liveId]` — the role split (08.5-09, D-434, UI-D-435, planning decision 1).
 *
 * **Member** (everyone without `courses.manage`): ONE learn read, `GET /v1/courses/learn/lives/{id}`
 * → the member live page (`MemberLivePage`) with the ONE state zone the server decided; `not_found`
 * (an unknown, foreign or crafted id) → the segment's "Live indisponível" (`not-found.tsx`,
 * UI-D-441); a read failure → the error card with a retry to this URL.
 *
 * **Preview** (08.6-11, UI-D-459, D-422): an `admin_tenant` with `?ver=aluno` — the link every
 * preview surface keeps (Início's live, the Lives tab cards) — gets the MEMBER page too, with the
 * reminder toggle disabled and its hint; without the flag the manager keeps the live form. A
 * member's or a `support_tenant`'s `?ver=` changes nothing (they always get the member page).
 *
 * **Admin** — `/cursos/lives/[liveId]` (08.3-11, D-416, D-418, UI-D-403, UI-D-418, COURSE-11): the edit half of the SAME form —
 * the row the Lives tab links to (UI-D-392).
 *
 * **Permission first, then the read** (the loja posture): the gate of `cursos/layout.tsx` is repeated
 * here so a refused caller's request never fires the live read. Every miss is the school's one
 * not-found (an unknown, foreign or vanished live — the API answers one bare 404 for both, D-23); a
 * read FAILURE throws, so a form filled with blanks is never offered over a live that is fine.
 *
 * **The status is the SERVER's** (UI-D-403, UI-D-407): the API projected it against its clock when
 * it answered, and the page hands it to the form with the tenant timezone — the form reads no clock.
 * The replay picker's lessons are read ONLY when the live is `recorded` (the row exists only then);
 * a scheduled, on-air or cancelled live never pays for that read. The read-only "Acesso" line
 * (UI-D-418) lists the live detail's `products` ONLY while the store is on, the admin manages it
 * and at least one product opens the live (a cancelled live included); no product list is loaded,
 * this form never writes a link (D-418).
 */
export default async function EditLivePage({
  params,
  searchParams,
}: {
  params: Promise<{ liveId: string }>;
  searchParams: Promise<{ ver?: string | string[] }>;
}) {
  const [{ liveId }, bootstrap, query] = await Promise.all([
    params,
    requireBootstrap(),
    searchParams,
  ]);
  if (!bootstrap.modules.some((module) => module.key === 'courses')) notFound();
  const storeOn = bootstrap.modules.some((module) => module.key === 'store');
  if (!bootstrap.permissions.includes(COURSE_PERMISSIONS.manage)) {
    return renderMemberLive(liveId, bootstrap.tenant.timezone, storeOn, false);
  }
  if (isPreview(bootstrap, query.ver)) {
    return renderMemberLive(liveId, bootstrap.tenant.timezone, storeOn, true);
  }
  const canManageStore = bootstrap.permissions.includes(STORE_PERMISSIONS.manage);

  const result = await getLive(liveId);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled') notFound();
  if (result.status === 'not-found') notFound();
  if (result.status === 'error') throw new Error('courses.live_unavailable');

  const live = result.live;
  const lessons = live.status === 'recorded' ? await getLessonsForPicker() : null;
  const accessProducts =
    storeOn && canManageStore && live.products.length > 0
      ? communityAccessProductsView(live.products)
      : undefined;

  return (
    <LiveForm
      mode="edit"
      liveId={live.id}
      initial={liveFormDefaults(live, bootstrap.tenant.timezone)}
      status={live.status}
      tenantName={bootstrap.tenant.displayName}
      timeZone={bootstrap.tenant.timezone}
      accessProducts={accessProducts}
      lessons={lessons}
    />
  );
}

const LINK_OUTLINE =
  'inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The member branch: the live page, "Live indisponível" or the error card. */
async function renderMemberLive(
  liveId: string,
  timeZone: string,
  storeOn: boolean,
  preview: boolean,
) {
  const result = await getLearnLive(liveId);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'not_found' || result.status === 'disabled') notFound();
  if (result.status === 'error') return <LiveErrorCard liveId={liveId} />;
  return (
    <MemberLivePage live={result.live} timeZone={timeZone} storeOn={storeOn} preview={preview} />
  );
}

/** A failed live read (E10 error): the shipped error words and a retry to this URL. */
async function LiveErrorCard({ liveId }: { liveId: string }) {
  const t = await getTranslations('courses');
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      <PageHeader
        backHref={MEMBER_LIVES_HREF}
        backLabel={t('member.live.back')}
        className="md:static md:px-0"
      />
      <div className="px-4 pt-2">
        <EmptyState
          variant="card"
          icon={CircleAlert}
          data-testid="live-error"
          title={t('errors.title')}
          body={t('errors.lives')}
          action={
            <a href={`/cursos/lives/${encodeURIComponent(liveId)}`} className={LINK_OUTLINE}>
              {t('errors.retry')}
            </a>
          }
        />
      </div>
    </div>
  );
}
