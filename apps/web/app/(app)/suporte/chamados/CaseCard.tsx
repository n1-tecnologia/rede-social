import { cn, Skeleton, StatusPill } from '@rede-social/ui';
import { CircleCheck, CircleDot, Lock, Mic, UserCheck } from 'lucide-react';
import Link from 'next/link';
import type { CaseCardView, CaseStateGlyph } from '@/lib/chat-view';

/**
 * One "Meus chamados" card (UI-D-821, A-UI-17) [ported + designed]: the prototype's `ConversationCard`
 * as ONE anchor to the case's own route, on the shipped card surface. It takes the finished
 * `caseCardView` of plan 11, so every word is already from the catalog and the formatted time is the
 * tenant clock's; this draws named fields only, which is why no priority, owner or history can appear
 * (UI-D-835). Every string is a React text node (T-12.4-63).
 *
 * - **Row 1:** "Chamado #N" 12/700 tertiary and the state pill (the word is always drawn, so colour is never
 *   the only signal). The row never wraps: the pill stays beside the number.
 * - **Subject:** 14/700 clamped to two lines; a case with no stored subject shows its derived label in
 *   14/400 (D-814).
 * - **Preview:** one truncated line with its "Você:" or "Equipe:" prefix, absent for a case with no message.
 *   A recording (`previewKind` `voice`, 12.5 D-860) gets a decorative `Mic` 14 glyph before the text; a deleted
 *   recording (`voiceDeleted`) and plain text get none. The finished string already carries the words.
 * - **Last row:** the category word, a middle dot, and the relative time at the right.
 * - **Closed:** NOT faded (a transparency would drop the text contrast): the neutral pill and the secondary
 *   text colour on the subject say it.
 */

const GLYPHS: Record<CaseStateGlyph, typeof CircleDot> = {
  CircleDot,
  UserCheck,
  CircleCheck,
  Lock,
};

export function CaseCard({ card }: { card: CaseCardView }) {
  const Glyph = GLYPHS[card.state.glyph];
  return (
    <Link
      href={card.href}
      data-case-card
      className="block min-h-11 overflow-hidden rounded-xl bg-card p-4 shadow-[0_1px_3px_rgba(22,35,59,.06)] transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg dark:border dark:border-border"
    >
      <div data-case-row-1 className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-xs font-bold text-text-tertiary">{card.title}</span>
        <StatusPill data-case-pill tone={card.state.tone} className="shrink-0">
          <Glyph aria-hidden size={12} />
          {card.state.label}
        </StatusPill>
      </div>
      <p
        className={cn(
          'mt-2 line-clamp-2 break-words text-sm',
          card.hasSubject ? 'font-bold' : 'font-normal',
          card.closed ? 'text-text-secondary' : 'text-text',
        )}
      >
        {card.subject}
      </p>
      {card.preview ? (
        card.previewKind === 'voice' ? (
          <p
            data-case-preview
            className="mt-1 flex min-w-0 items-center gap-1 text-sm font-normal text-text-secondary"
          >
            <Mic aria-hidden size={14} className="shrink-0" />
            <span data-case-preview-text className="min-w-0 truncate">
              {card.preview}
            </span>
          </p>
        ) : (
          <p data-case-preview className="mt-1 truncate text-sm font-normal text-text-secondary">
            {card.preview}
          </p>
        )
      ) : null}
      <div className="mt-2 flex items-center gap-1 text-xs font-normal text-text-tertiary">
        <span className="min-w-0 truncate">{card.category}</span>
        <span aria-hidden>·</span>
        <span className="ml-auto shrink-0">{card.time}</span>
      </div>
    </Link>
  );
}

/**
 * One card skeleton at `CaseCard`'s own geometry (UI-D-832): the number bar and the pill on row 1, two
 * subject lines, the preview line and the category and time row. Shared by `loading.tsx` and the load-more
 * sentinel, so the swap to cards does not move anything.
 */
export function CaseCardSkeleton({ count }: { count: number }) {
  return (
    <div aria-busy data-case-skeletons className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders, never reordered.
          key={index}
          className="min-h-11 rounded-xl bg-card p-4 shadow-[0_1px_3px_rgba(22,35,59,.06)] dark:border dark:border-border"
        >
          <div className="flex items-center justify-between gap-2">
            <Skeleton variant="text" width={88} className="h-3" />
            <Skeleton variant="rect" width={64} className="h-5 rounded-full" />
          </div>
          <Skeleton variant="text" width="82%" className="mt-3 h-3.5" />
          <Skeleton variant="text" width="56%" className="mt-2 h-3.5" />
          <Skeleton variant="text" width="70%" className="mt-2 h-3.5" />
          <div className="mt-3 flex items-center justify-between gap-2">
            <Skeleton variant="text" width={72} className="h-3" />
            <Skeleton variant="text" width={40} className="h-3" />
          </div>
        </div>
      ))}
    </div>
  );
}
