'use client';

import { buttonClasses, StatusPill } from '@rede-social/ui';
import { ChevronRight, CircleCheck, CircleDot, Lock, UserCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CaseStateGlyph, MemberCaseHeaderView } from '@/lib/chat-view';

/**
 * The member's case bar (UI-D-818, UI-D-820a) [designed].
 *
 * **The bar** sits between the shipped `ThreadHeader` and the scroller. Row 1 is "Chamado #N" 14/700, the
 * state pill (its word is always drawn, so colour is never the only signal) and the "Meus chamados" link.
 * The title and the pill never break apart; when the link does not fit beside them it drops to its own
 * right-aligned line (the sketch 023 outcome: it never fits at 320 px, and `Em atendimento` never fits at
 * 390 px). Row 2 is the subject on ONE truncated line, ALWAYS the server's `subjectLabel` (the typed
 * subject, else the start of the first message), so a case migrated with no subject still has it. The
 * slim bar of a member with no active case but past cases holds only the link; with no case at all
 * there is no bar. The bar never shows the priority, the owner, the history or the category: it reads
 * NAMED fields of the finished member header, so nothing a payload wrongly carried can reach it
 * (T-12.4-55, UI-D-835).
 *
 * Every word is the `chat` catalog's; every string is a React text node.
 */

const GLYPHS: Record<CaseStateGlyph, typeof CircleDot> = {
  CircleDot,
  UserCheck,
  CircleCheck,
  Lock,
};

export interface CaseBarProps {
  /** The finished member header of the active (or watched) case; `null` when there is none. */
  header: MemberCaseHeaderView | null;
  /** The member ever opened a case: with no active one the slim bar still holds the link. */
  hasAnyCase: boolean;
}

function MineLink() {
  const t = useTranslations('chat');
  return (
    <a
      href="/suporte/chamados"
      className={buttonClasses({
        variant: 'ghost',
        size: 'sm',
        hitArea: true,
        className: 'ml-auto',
      })}
    >
      {t('case.mine')}
      <ChevronRight aria-hidden size={16} />
    </a>
  );
}

export function CaseBar({ header, hasAnyCase }: CaseBarProps) {
  const t = useTranslations('chat');

  if (!header) {
    if (!hasAnyCase) return null;
    return (
      <div
        data-case-bar
        data-case-slim
        className="border-b border-border bg-bg-secondary px-4 py-2"
      >
        <div className="flex min-h-11 items-center">
          <MineLink />
        </div>
      </div>
    );
  }

  const Glyph = GLYPHS[header.state.glyph];
  return (
    <div data-case-bar className="border-b border-border bg-bg-secondary px-4 py-2">
      <div className="flex min-h-11 flex-wrap items-center gap-x-2">
        <div className="flex min-h-9 items-center gap-2">
          <span className="sr-only">
            {t('case.srName', { number: String(header.number), state: header.state.label })}
          </span>
          <span aria-hidden className="text-sm font-bold text-text">
            {header.title}
          </span>
          <StatusPill aria-hidden tone={header.state.tone}>
            <Glyph aria-hidden size={12} />
            {header.state.label}
          </StatusPill>
        </div>
        <MineLink />
      </div>
      <p data-case-subject className="truncate text-xs font-normal text-text-secondary">
        {header.subject}
      </p>
    </div>
  );
}

/**
 * The one-time confirmation row of the client that opened the case (UI-D-820a, A-UI-16): at the top of
 * the scroller until the page is reloaded or left, with no timer. Never drawn on a reload or from another
 * device.
 */
export function CaseOpenedRow({ number }: { number: number }) {
  const t = useTranslations('chat');
  return (
    <div
      role="status"
      data-case-opened
      className="mx-4 mt-4 flex items-start gap-2 rounded-xl bg-success/10 p-4"
    >
      <CircleCheck aria-hidden size={16} className="mt-0.5 shrink-0 text-success" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-bold text-text">
          {t('case.opened.title', { number: String(number) })}
        </p>
        <p className="text-xs font-normal text-text-secondary">{t('case.opened.body')}</p>
      </div>
    </div>
  );
}
