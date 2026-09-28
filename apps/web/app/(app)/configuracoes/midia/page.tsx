import { PageHeader } from '@rede-social/ui';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadMediaAssets } from '@/lib/media';
import { MediaLibrary } from './MediaLibrary';

/**
 * `/configuracoes/midia` (MEDIA-03, R-04, UI-SPEC §Admin media) — the minimal `admin_tenant` screen
 * that makes ROADMAP criterion 4 observable: one upload zone, a status list, and a player for a
 * ready video. Phase 4's composer reuses the upload hook and `VideoPlayer`, NOT this screen, and no
 * "pick an existing asset" affordance ever lands here (CONTEXT §Deferred Ideas).
 *
 * **`notFound()`, never a 403 screen.** A member or a `support_tenant` must not learn that an admin
 * media screen exists at all — the settings row is absent from their DOM and this route answers the
 * app's own not-found page, which is the repo's isolation convention (the same posture
 * `/membros/[membershipId]` takes for another community's member). `notFound()` throws, so it sits
 * outside any try/catch (Next 16 rule).
 */
export default async function AdminMediaPage() {
  const bootstrap = await requireBootstrap();
  if (bootstrap.membership.role !== 'admin_tenant') notFound();

  const [t, page] = await Promise.all([
    getTranslations('media'),
    loadMediaAssets({ kind: 'video' }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
      {/* `stickyTop="0px"` for the same reason `/membros` passes it: the primitive's default
          `calc(var(--safe-top) + 3rem)` is measured from the scrollport's padding edge, so it
          pushes the header ~60px DOWN over whatever follows it (03-05's finding). */}
      <PageHeader
        title={t('library.title')}
        backHref="/configuracoes"
        backLabel={t('library.back')}
        stickyTop="0px"
        className="md:static md:px-0"
      />

      <MediaLibrary
        initialItems={page?.items ?? []}
        initialCursor={page?.nextCursor ?? null}
        initialError={page === null}
        timeZone={bootstrap.tenant.timezone}
      />
    </div>
  );
}
