import { Card, Skeleton } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { loadMemberAnswers } from '@/lib/profile-form/profile-reads';
import { PublicAnswersBlock } from './PublicAnswersBlock';
import { StaffAnswersBlock } from './StaffAnswersBlock';

const STAFF_ROLES: ReadonlySet<string> = new Set(['admin_tenant', 'support_tenant']);

export interface MemberAnswersBlockProps {
  /** The membership whose answers are read (the page's target, never the caller). */
  membershipId: string;
  /** The target's display name, used by the public block's heading. */
  name: string;
  /** The VIEWER's role: `member` gets the public block, admin and support the staff block. */
  role: string;
  /** The page's own URL, for the "Tentar novamente" link of the inline error. */
  retryHref: string;
}

/** Three rows while the read is pending (UI-D-592, UI-D-593): a 12px bar over a 14px bar, `p-4`. */
export function MemberAnswersSkeleton() {
  return (
    <div aria-busy data-testid="member-answers-skeleton" className="px-4">
      <Card className="divide-y divide-border">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex flex-col gap-2 p-4">
            <Skeleton variant="text" width="40%" className="h-3" />
            <Skeleton variant="text" width="70%" className="h-3.5" />
          </div>
        ))}
      </Card>
    </div>
  );
}

/**
 * The small error row (UI-D-592): the base profile has rendered, only this slot failed, and it says so
 * with a link that reloads the same page. A plain `<a>`, so the retry reloads the document.
 */
export async function AnswersErrorRow({ retryHref }: { retryHref: string }) {
  const t = await getTranslations('profileForm.profile.public');
  return (
    <div className="px-4" data-member-answers="error">
      <Card>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs font-normal text-text-secondary">
          <CircleAlert aria-hidden size={16} className="shrink-0 text-danger" />
          <span>{t('error')}</span>
          <a
            href={retryHref}
            className="inline-flex min-h-11 items-center rounded-md text-xs font-bold text-brand underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {t('retry')}
          </a>
        </div>
      </Card>
    </div>
  );
}

/**
 * Exported for the unit test: the awaited half of the block, rendered without the Suspense. The viewer's
 * role picks the block and a mix-up never falls through to the other (a member never renders a staff
 * payload, whatever the API sent); an absent answer (the API's bare 404) is no block at all.
 */
export async function MemberAnswersData({
  membershipId,
  name,
  role,
  retryHref,
}: MemberAnswersBlockProps) {
  const result = await loadMemberAnswers(membershipId);
  if (result.status === 'absent') return null;
  // The sibling blocks are async components: calling them returns their element, so this one await
  // yields a tree with nothing left to resolve (a Server Component renders it, so does a test).
  if (result.status === 'error') return AnswersErrorRow({ retryHref });

  const { payload } = result;
  if (role === 'member' && payload.kind === 'member') {
    return PublicAnswersBlock({ name, answers: payload.answers });
  }
  if (STAFF_ROLES.has(role) && payload.kind === 'staff') {
    return StaffAnswersBlock({ answers: payload.answers, branches: payload.branches ?? [] });
  }
  return null;
}

/**
 * Another member's form answers under their header (12-14, D-593, UI-D-592, UI-D-593): the public block
 * for a member viewer, the staff block for `admin_tenant` and `support_tenant`. It is its own read in its
 * own `Suspense`, AFTER the base profile, so the profile never waits for it and never disappears when it
 * fails. Any other role makes no request and renders nothing.
 */
export function MemberAnswersBlock(props: MemberAnswersBlockProps) {
  if (props.role !== 'member' && !STAFF_ROLES.has(props.role)) return null;
  return (
    <Suspense fallback={<MemberAnswersSkeleton />}>
      <MemberAnswersData {...props} />
    </Suspense>
  );
}
