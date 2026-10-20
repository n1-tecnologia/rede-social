import type { Bootstrap } from '@rede-social/contracts';
import { buttonClasses, EmptyState } from '@rede-social/ui';
import { UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { withAuthorInstagrams } from '@/lib/author-instagram';
import { loadFeed } from '@/lib/feed';
import { buildFeedSurface } from '@/lib/registry';

/** The action of the two member empty states: the directory (D-466), an OUTLINE button on purpose. */
const FIND_LINK = buttonClasses({ variant: 'outline', size: 'md' });

type Translator = Awaited<ReturnType<typeof getTranslations>>;

/**
 * The three Explorar empty states, ONE component (UI-D-494, EXPL-04), chosen HERE on the server:
 *
 *  - (a) a member who follows nobody and has no post: `UserPlus`, "Siga pessoas para ver o que elas
 *    publicam", the body with the tenant name and the "Encontrar pessoas" action;
 *  - (b) a member who follows people who have not posted (and has no post): `Users`, "Ainda não há
 *    publicações", the same action;
 *  - (c) a moderator and no member post: `Users`, "Nenhuma publicação de membros", NO action (a
 *    moderator is outside the follow graph, D-467).
 *
 * The choice reads the page's `followsAnyone` (the API decides it on an empty first page and sends it
 * only to a non-moderator) and the viewer's composed permissions, never a role: the client infers
 * nothing. The action is an outline button because the composer FAB is already this screen's single
 * brand fill (UI-D-494). `null` when the viewer is neither (the list then keeps its built-in card).
 */
function exploreEmpty(
  t: Translator,
  tenantName: string,
  permissions: readonly string[],
  followsAnyone: boolean | undefined,
): ReactNode {
  if (permissions.includes('social.participate')) {
    const none = followsAnyone === false;
    const key = none ? 'social.explore.emptyNone' : 'social.explore.emptyQuiet';
    return (
      <EmptyState
        variant="card"
        icon={none ? UserPlus : Users}
        title={t(`${key}.title`)}
        body={t(`${key}.body`, { tenant: tenantName })}
        action={
          <Link href="/membros" className={FIND_LINK}>
            {t(`${key}.cta`)}
          </Link>
        }
      />
    );
  }
  if (permissions.includes('moderation.manage')) {
    return (
      <EmptyState
        variant="card"
        icon={Users}
        title={t('social.explore.emptyStaff.title')}
        body={t('social.explore.emptyStaff.body')}
      />
    );
  }
  return null;
}

/**
 * The Explorar body (D-479, UI-D-493): `/inicio?aba=explorar` is the chip row and the feed, and
 * nothing else - no welcome block, no `HomeSlots` widgets, no stories strip, no profile nudge. The
 * feed is the SAME surface Início renders (`buildFeedSurface`, so the cards, the comment sheet, the
 * share and menu props and the Reels overlay are one implementation) fed by `scope: 'explorar'`
 * through `loadFeed`, the one fetch function the load-more and refresh actions also call.
 *
 * An unreadable first page is `null` and the surface renders the feed's own error card with
 * "Tentar novamente"; a refusal the bootstrap knows becomes a navigation inside `loadFeed`.
 */
export async function ExplorarBody({ bootstrap }: { bootstrap: Bootstrap }) {
  const [loaded, t] = await Promise.all([
    loadFeed({ scope: 'explorar' }).then(withAuthorInstagrams),
    getTranslations(),
  ]);
  const empty = exploreEmpty(
    t,
    bootstrap.tenant.displayName,
    bootstrap.permissions,
    loaded.page?.followsAnyone,
  );
  return buildFeedSurface(bootstrap, {
    scope: 'explorar',
    loaded: Promise.resolve(loaded),
    ...(empty === null ? {} : { empty }),
  });
}
