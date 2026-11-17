'use client';

import type { ChatCaseState } from '@rede-social/module-chat/contracts';
import { useToast } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StaffCaseHeaderView } from '@/lib/chat-view';
import { runCaseActionAction } from './actions';

/**
 * The team's case actions from the thread bar (UI-D-826, UI-D-827, D-805, D-806, D-843, D-845) [client].
 *
 * The hook sends INTENT and nothing else: the action word, the state the screen showed and, for a take of a
 * case that has a stored owner, that owner's id (the server answers `case_stale` when it changed, T-12.4-88).
 * It never decides which action is legal (the bar draws the server's `actions[]`), never computes a
 * transition and never holds a staff id other than the expected owner it was handed. What the server
 * answers is all it believes: the fresh header goes to `onHeader`; a refusal becomes a toast.
 *
 * **Who asks first.** Resolve, close and reopen always open their dialog. A take asks only when the case is
 * owned by a live person other than the viewer (a take-over); an unowned case, and a case whose owner left
 * the staff (the server then sends no owner name, D-843), are taken at once.
 *
 * **What the confirm sends.** The state and owner are captured WHEN THE ACTION IS REQUESTED, not when the
 * dialog is confirmed: a dialog that stayed open while the case changed under it still opens, and the
 * server refuses the stale write (UI-D-830, T-12.4-71).
 *
 * **Refusals.** `stale`, `closed` and `not_allowed` all say the screen was behind the case, so they toast
 * the stale sentence and ask the pane to re-read (`onStale`); `invalid` and `failed` toast the generic
 * failure and keep what is drawn. A thrown action is the same generic failure.
 */

export type CaseActionKind = 'take' | 'resolve' | 'close' | 'reopen';

/** What a dialog needs to draw and to send: captured at request time (see above). */
export interface CaseDialogRequest {
  kind: CaseActionKind;
  number: number;
  /** The live owner's name, for the take-over dialog only. */
  ownerName: string | null;
  expectedState: ChatCaseState;
  expectedOwnerId: string | null;
}

export interface UseCaseActionsOptions {
  conversationId: string;
  header: StaffCaseHeaderView;
  /** The fresh finished header the server answered after a successful action. */
  onHeader: (header: StaffCaseHeaderView) => void;
  /** The screen was behind the case: re-read it. */
  onStale: () => void;
}

const SUCCESS_KEY: Record<CaseActionKind, string> = {
  take: 'toast.taken',
  resolve: 'toast.resolved',
  close: 'toast.closed',
  reopen: 'toast.reopened',
};

export function useCaseActions({
  conversationId,
  header,
  onHeader,
  onStale,
}: UseCaseActionsOptions) {
  const t = useTranslations('chat');
  const { show } = useToast();
  const [pending, setPending] = useState<CaseActionKind | null>(null);
  const [dialog, setDialog] = useState<CaseDialogRequest | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const send = useCallback(
    async (request: CaseDialogRequest) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setPending(request.kind);
      const number = String(request.number);
      try {
        const result = await runCaseActionAction(conversationId, {
          action: request.kind,
          expectedState: request.expectedState,
          // Only a take-over names the owner it expects; every other action is guarded by the state alone.
          ...(request.kind === 'take' && request.expectedOwnerId
            ? { expectedOwnerId: request.expectedOwnerId }
            : {}),
        });
        if (result.ok) {
          onHeader(result.header);
          show({ tone: 'success', message: t(SUCCESS_KEY[request.kind], { number }) });
        } else if (
          result.error === 'stale' ||
          result.error === 'closed' ||
          result.error === 'not_allowed'
        ) {
          show({ tone: 'error', message: t('toast.stale') });
          onStale();
        } else {
          show({ tone: 'error', message: t('toast.failed') });
        }
      } catch {
        show({ tone: 'error', message: t('toast.failed') });
      } finally {
        busyRef.current = false;
        if (mounted.current) setPending(null);
      }
    },
    [conversationId, onHeader, onStale, show, t],
  );

  /** A tap on an action: asks first when the matrix says so, else sends at once. */
  const request = useCallback(
    (kind: CaseActionKind) => {
      if (busyRef.current) return;
      const liveOwner = !header.ownerIsViewer && header.ownerName !== null;
      const asked: CaseDialogRequest = {
        kind,
        number: header.number,
        ownerName: kind === 'take' ? header.ownerName : null,
        expectedState: header.state.state,
        expectedOwnerId: header.ownerUserId,
      };
      if (kind === 'take' && !liveOwner) {
        void send(asked);
        return;
      }
      setDialog(asked);
    },
    [header, send],
  );

  /** The dialog's confirm: the dialog closes itself when this settles. */
  const confirm = useCallback(async () => {
    if (!dialog) return;
    await send(dialog);
  }, [dialog, send]);

  const dismiss = useCallback(() => setDialog(null), []);

  return { pending, dialog, request, confirm, dismiss };
}
