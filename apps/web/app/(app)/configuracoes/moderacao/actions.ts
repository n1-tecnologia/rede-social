'use server';

import { moderationLogQuerySchema } from '@rede-social/contracts/moderation';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath, getBootstrap } from '@/lib/bootstrap';
import { getModerationLog } from '@/lib/moderation';
import {
  type ModerationLogRowView,
  type ModerationLogTranslator,
  moderationLogLabels,
  toModerationLogView,
} from '@/lib/moderation-view';

/**
 * The Moderação list's one action (MODER-03, D-337, UI-D-277), in the `notificacoes/actions.ts`
 * conventions:
 *
 * - the SAME Zod the API validates with (`moderationLogQuerySchema`) runs BEFORE the request — a
 *   server action is a public endpoint, so an unknown action or a malformed cursor is refused here
 *   and never reaches the API (T-08-16);
 * - session and membership refusals become a navigation OUTSIDE the try/catch (Next 16: `redirect()`
 *   throws);
 * - a 403 `FORBIDDEN` (the permission was lost since the page rendered) answers `forbidden`, and the
 *   CALLER toasts and refreshes (UI-D-284), which lands on `notFound()`;
 * - it returns FINISHED row views: the sentence, the context, the quoted excerpt and the absolute
 *   time in the tenant's zone are built here, on the server, with the page's own builder, so a row
 *   from page 7 reads exactly like a row from page 1 and the client never formats a date.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

export type ModerationLogPageResult =
  | { ok: true; items: ModerationLogRowView[]; nextCursor: string | null }
  | { ok: false; code: 'generic' | 'forbidden' };

/**
 * One keyset page of the log for the chip's `action` (`null` = "Tudo"). `cursor` null asks for page
 * 1 (what a pull-to-refresh calls); otherwise it is OPAQUE and forwarded untouched.
 */
export async function loadMoreModerationLogAction(
  cursor: string | null,
  action: string | null,
): Promise<ModerationLogPageResult> {
  if (cursor !== null && typeof cursor !== 'string') return { ok: false, code: 'generic' };
  if (action !== null && typeof action !== 'string') return { ok: false, code: 'generic' };
  const query = moderationLogQuerySchema.safeParse({
    ...(action === null ? {} : { action }),
    ...(cursor === null ? {} : { cursor }),
  });
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: ModerationLogPageResult = { ok: false, code: 'generic' };
  try {
    const [page, bootstrap, t] = await Promise.all([
      getModerationLog({ action: query.data.action, cursor: query.data.cursor }),
      getBootstrap(),
      getTranslations('moderation.log'),
    ]);
    const labels = moderationLogLabels(t as unknown as ModerationLogTranslator);
    const timezone = bootstrap.tenant.timezone;
    result = {
      ok: true,
      items: page.items.map((entry) => toModerationLogView(entry, { timezone, labels })),
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    if (error instanceof ApiClientError) {
      refusal = bootstrapRedirectPath(error);
      if (!refusal && error.status === 403 && error.code === 'FORBIDDEN') {
        result = { ok: false, code: 'forbidden' };
      }
    }
    // Shape only: an excerpt or a reason is member content and never reaches a log line.
    if (!refusal && !(result.ok === false && result.code === 'forbidden')) {
      console.error('moderation.log.load_more_failed', { error: String(error) });
    }
  }

  if (refusal) redirect(refusal);
  return result;
}
