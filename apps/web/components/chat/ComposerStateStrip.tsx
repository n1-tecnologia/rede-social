'use client';

import { Button } from '@rede-social/ui';
import { Ban, Lock } from 'lucide-react';
import type { ComposerStripView } from '@/lib/chat-view';

/**
 * The composer slot's three read-only strips (11-22, CHAT-07, D-721, D-722, D-723, UI-D-865) [designed]: what
 * stands where the field and the microphone were when the conversation can no longer be written to. The words
 * and the kind arrive FINISHED from `composerStateView` (plan 18); this component draws and never decides.
 *
 * - **closed** (the member the other side blocked): `Lock` and the ONE sentence "Esta conversa não aceita novas
 *   mensagens." No name, no reason, no date, no button, nothing that says who or why (T-11-03). The composer AND
 *   its microphone are not drawn at all.
 * - **blocker** (the member who blocked): `Ban`, "Você bloqueou {nome}" (clamped to two lines, `break-words`) and
 *   the outline "Desbloquear", full width on its own line below 360px. One tap, no confirmation; the pending word
 *   is "Desbloqueando…".
 * - **removed** (the other member left): `Lock` and the read-only sentence, no button.
 *
 * Every strip is `role="status"` (polite, spoken once when it appears live) and its accessible name is the very
 * same sentence, so the blocked side hears only "Esta conversa não aceita novas mensagens.". The geometry is the
 * support thread's shipped read-only strip. Every string is a React text node (T-11-16).
 */
export interface ComposerStateStripProps {
  strip: ComposerStripView;
  /** The blocker's one-tap unblock; the strip draws the button only when the view carries one. */
  onUnblock?: () => void;
  /** An unblock is in flight: the button reads its pending word and cannot be tapped twice. */
  pending?: boolean;
}

const GLYPHS = { Lock, Ban } as const;

export function ComposerStateStrip({ strip, onUnblock, pending = false }: ComposerStateStripProps) {
  const Glyph = GLYPHS[strip.glyph];
  const unblock = strip.unblock;
  return (
    <div
      role="status"
      aria-label={strip.label}
      data-composer-strip={strip.kind}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-bg-secondary px-4 py-3"
    >
      <Glyph aria-hidden size={20} className="shrink-0 text-text-tertiary" />
      <p
        className={
          strip.kind === 'blocker'
            ? 'min-w-0 flex-1 line-clamp-2 break-words text-sm font-normal text-text-secondary'
            : 'min-w-0 flex-1 text-sm font-normal text-text-secondary'
        }
      >
        {strip.text}
      </p>
      {unblock ? (
        <Button
          variant="outline"
          size="sm"
          hitArea
          loading={pending}
          onClick={onUnblock}
          className="w-full min-[360px]:ml-auto min-[360px]:w-auto"
        >
          {pending ? unblock.pendingLabel : unblock.label}
        </Button>
      ) : null}
    </div>
  );
}
