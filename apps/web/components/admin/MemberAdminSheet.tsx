'use client';

import { type AdminMember, MODERATION_REASON_MAX } from '@rede-social/contracts/moderation';
import { BottomSheet, Button, Textarea, useMediaQuery } from '@rede-social/ui';
import { Ban, LockOpen } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef, useState, useTransition } from 'react';
import { MemberAvatar, MemberPills, memberName } from './AdminMemberRow';

/** The answer of a block or unblock server action, as the sheet reads it. */
export type MemberAccessOutcome =
  | { ok: true; member: AdminMember }
  | {
      ok: false;
      code: 'self' | 'last_admin' | 'not_active' | 'generic' | 'gone' | 'forbidden';
    };

/** What the sheet hands back to its host once an access change is over. */
export type MemberSheetSettled =
  | { kind: 'changed'; member: AdminMember; change: 'block' | 'unblock' }
  | { kind: 'gone'; membershipId: string }
  | { kind: 'forbidden' };

export interface MemberAdminSheetProps {
  /** The membership shown. Kept by the host while the sheet animates out. */
  member: AdminMember | null;
  open: boolean;
  /** MUST be stable (`useCallback`): the shipped focus trap re-arms when it changes. */
  onClose: () => void;
  /** Interpolated into the effect bodies and the last-admin refusal. */
  tenantName: string;
  /** `moderation.manage`: the access action. Without it the sheet shows no action (UI E04/partial). */
  canModerate: boolean;
  /** Opened from the profile page there is no "Ver perfil" (UI-D-275). */
  showViewProfile?: boolean;
  /** The server action. The sheet never decides a guard; it only explains a refusal. */
  onAccess: (
    membershipId: string,
    kind: 'block' | 'unblock',
    reason: string | undefined,
  ) => Promise<MemberAccessOutcome>;
  /** Success, a vanished member (404) or a lost permission (403): the HOST closes, toasts, refreshes. */
  onSettled: (outcome: MemberSheetSettled) => void;
}

/** The counter appears from 450 characters (UI-D-274), never before. */
const COUNTER_FROM = 450;

type Refusal = 'self' | 'last_admin' | 'not_active' | 'generic';

const REFUSAL_KEY: Record<Refusal, 'self' | 'lastAdmin' | 'notActive' | 'generic'> = {
  self: 'self',
  last_admin: 'lastAdmin',
  not_active: 'notActive',
  generic: 'generic',
};

/** The sheet's `<h2>` (the shipped `BottomSheet` owns it), made programmatically focusable. */
function focusTitleOf(anchor: HTMLElement | null) {
  const title = anchor?.closest('[role="dialog"]')?.querySelector<HTMLElement>('h2');
  if (!title) return;
  title.tabIndex = -1;
  title.focus({ preventScroll: true });
}

/**
 * THE member admin sheet (UI-D-272..274, D-330..D-333, D-340): one component for both entry points —
 * a Membros row and, in 08-05, the profile's "⋯" — so the two can never offer different actions.
 *
 * - **Main step.** The identity block (56px avatar, e-mail, pills); for `moderation.manage` holders
 *   the access action: danger "Bloquear acesso" on an active membership, brand "Desbloquear acesso"
 *   on a blocked one; on an active membership the outline "Ver perfil" link. An INVITED membership
 *   shows the identity block and one paragraph, nothing else (A7). The role list joins in 08-05.
 * - **Confirm step** (the `HighlightEditSheet` pattern: the content SWAPS, no second sheet is
 *   stacked). Title "Bloquear {name}?" / "Desbloquear {name}?", the effect body (D-330: comments stay
 *   visible), the optional INTERNAL reason (D-331: "{name} não vê o motivo"), "Voltar" and the
 *   confirm. "Voltar" keeps the typed reason. An empty or whitespace-only reason is sent as none.
 * - **Refusals** (`self`, `last_admin`, `not_active`, generic) render inline with `role="alert"`
 *   above the footer; the step and the reason stay. The UI never predicts a D-332 guard.
 * - **No optimistic update.** The confirm waits for the server (pending label, inert step); success
 *   goes back to the host, which closes the sheet, toasts and updates the row in place.
 * - **Focus** (UI-D-288): the title on open, the reason field on the confirm step, the action button
 *   after "Voltar"; on close the shipped trap returns focus to the row that opened the sheet.
 */
export function MemberAdminSheet({
  member,
  open,
  onClose,
  tenantName,
  canModerate,
  showViewProfile = true,
  onAccess,
  onSettled,
}: MemberAdminSheetProps) {
  const t = useTranslations('admin.members');
  const tm = useTranslations('moderation.member');
  const [step, setStep] = useState<'main' | 'confirm'>('main');
  const [reason, setReason] = useState('');
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [pending, startTransition] = useTransition();

  const contentRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const returnToAction = useRef(false);
  const desktop = useMediaQuery('(min-width: 768px)');

  // A different membership (or a reopen) starts clean: main step, no draft, no refusal.
  const [shownId, setShownId] = useState<string | null>(member?.membershipId ?? null);
  const [wasOpen, setWasOpen] = useState(open);
  if (shownId !== (member?.membershipId ?? null) || wasOpen !== open) {
    setShownId(member?.membershipId ?? null);
    setWasOpen(open);
    if (open) {
      setStep('main');
      setReason('');
      setRefusal(null);
    }
  }

  // Focus: the title on open (after the trap's own first-focus), the reason on the confirm step,
  // the action button after "Voltar".
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (step === 'confirm') {
        reasonRef.current?.focus({ preventScroll: true });
      } else if (returnToAction.current) {
        returnToAction.current = false;
        contentRef.current
          ?.querySelector<HTMLElement>('[data-member-sheet-action]')
          ?.focus({ preventScroll: true });
      } else {
        focusTitleOf(contentRef.current);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open, step]);

  if (!member) return null;
  const name = memberName(member);
  const kind: 'block' | 'unblock' = member.status === 'blocked' ? 'unblock' : 'block';

  const confirm = () => {
    const trimmed = reason.trim();
    setRefusal(null);
    startTransition(async () => {
      let outcome: MemberAccessOutcome;
      try {
        outcome = await onAccess(member.membershipId, kind, trimmed === '' ? undefined : trimmed);
      } catch (error) {
        console.error('admin.members.access_failed', { error: String(error) });
        outcome = { ok: false, code: 'generic' };
      }
      if (outcome.ok) {
        onSettled({ kind: 'changed', member: outcome.member, change: kind });
        return;
      }
      if (outcome.code === 'gone') {
        onSettled({ kind: 'gone', membershipId: member.membershipId });
        return;
      }
      if (outcome.code === 'forbidden') {
        onSettled({ kind: 'forbidden' });
        return;
      }
      setRefusal(outcome.code);
    });
  };

  const back = () => {
    returnToAction.current = true;
    setRefusal(null);
    setStep('main');
  };

  const title =
    step === 'confirm'
      ? kind === 'block'
        ? tm('blockStep.title', { name })
        : tm('unblockStep.title', { name })
      : name;

  let body: ReactNode;
  if (step === 'confirm') {
    const helperId = 'member-access-reason-helper';
    const showCounter = reason.length >= COUNTER_FROM;
    body = (
      <div
        data-member-sheet-step="confirm"
        aria-busy={pending || undefined}
        className="flex flex-col gap-4"
      >
        <p className="text-sm font-normal text-text-secondary">
          {kind === 'block'
            ? tm('blockStep.body', { name, tenant: tenantName })
            : tm('unblockStep.body', { name, tenant: tenantName })}
        </p>
        <div className="flex flex-col gap-2">
          <Textarea
            ref={reasonRef}
            id="member-access-reason"
            label={tm('reason.label')}
            placeholder={tm('reason.placeholder')}
            rows={3}
            maxLength={MODERATION_REASON_MAX}
            value={reason}
            disabled={pending}
            onChange={(event) => setReason(event.target.value)}
            counter={showCounter ? { value: reason.length, max: MODERATION_REASON_MAX } : undefined}
            className="max-h-[7.5rem] overflow-y-auto"
            aria-describedby={showCounter ? `${helperId} member-access-reason-counter` : helperId}
          />
          <p id={helperId} className="text-xs font-normal text-text-tertiary">
            {tm('reason.helper', { name })}
          </p>
        </div>
        {refusal ? (
          <p data-member-sheet-error role="alert" className="text-sm font-normal text-danger">
            {tm(`errors.${REFUSAL_KEY[refusal]}`, { tenant: tenantName })}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-3 md:flex-row md:justify-end">
          <Button variant="ghost" onClick={back} disabled={pending} className="w-full md:w-auto">
            {tm('back')}
          </Button>
          <Button
            data-member-sheet-confirm
            variant={kind === 'block' ? 'danger' : 'brand'}
            loading={pending}
            onClick={confirm}
            className="w-full md:w-auto"
          >
            {kind === 'block'
              ? pending
                ? tm('blocking')
                : tm('confirmBlock')
              : pending
                ? tm('unblocking')
                : tm('confirmUnblock')}
          </Button>
        </div>
      </div>
    );
  } else {
    body = (
      <div data-member-sheet-step="main" className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <span className="shrink-0">
            <MemberAvatar member={member} size="lg" />
          </span>
          <div className="flex min-w-0 flex-col">
            <span
              data-member-sheet-email
              className="text-sm font-normal text-text-secondary [overflow-wrap:anywhere]"
            >
              {member.email}
            </span>
            <MemberPills member={member} />
          </div>
        </div>
        {member.status === 'invited' ? (
          <p data-member-sheet-invited className="text-sm font-normal text-text-secondary">
            {t('invitedBody', { email: member.email })}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {canModerate ? (
              <Button
                data-member-sheet-action={kind}
                variant={kind === 'block' ? 'danger' : 'brand'}
                size="md"
                fullWidth
                onClick={() => setStep('confirm')}
              >
                {kind === 'block' ? (
                  <Ban aria-hidden size={18} />
                ) : (
                  <LockOpen aria-hidden size={18} />
                )}
                {kind === 'block' ? tm('block') : tm('unblock')}
              </Button>
            ) : null}
            {member.status === 'active' && showViewProfile ? (
              <Link
                data-member-sheet-profile
                href={`/membros/${member.membershipId}`}
                className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                {t('viewProfile')}
              </Link>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={title} desktopCard={desktop}>
      <div ref={contentRef} data-member-sheet={member.membershipId}>
        {body}
      </div>
    </BottomSheet>
  );
}
