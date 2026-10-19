'use client';

import { buttonClasses, cn, useToast } from '@rede-social/ui';
import { Bell, BellRing } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { MEMBER_AREA_PATH } from '@/lib/member-area';
import { type LiveReminderRefusalCode, setLiveReminderAction } from './learn-actions';

/** The member Lives tab (`MEMBER_LIVES_HREF`), where a live that vanished since render sends the member. */
const LIVES_HREF = `${MEMBER_AREA_PATH}?aba=lives`;

/** The refusals that toast their own words; `generic` takes the on / off failure instead. */
const REFUSAL_KEY: Record<Exclude<LiveReminderRefusalCode, 'generic'>, string> = {
  live_locked: 'errors.locked',
  reminder_closed: 'errors.closed',
  gone: 'errors.gone',
};

export interface ReminderToggleProps {
  liveId: string;
  /** The live's title, for the constant `aria-label` "Lembrete da live {live}". */
  liveTitle: string;
  /** The SERVER's state: the overview's `reminderOn` on Início, `GET …/reminder` on the live page. */
  initialOn: boolean;
  /** The admin's "Ver como aluno": disabled, off, the hint in place of the helper, never a write. */
  preview: boolean;
  className?: string;
}

/**
 * The live reminder toggle (08.6-11, D-444..D-447, D-422, COURSE-40, UI-D-453, A-UI-9): the
 * prototype's full-width toggle BUTTON, used on Início's open next live and on the live page's
 * "before the window" zone. A `<button type="button" aria-pressed>` in the `outline` `md` geometry
 * (44px): off → `Bell` 18 + "Ativar lembrete"; on → the same geometry tinted `bg-brand/10
 * border-brand/30`, `BellRing` 18 in brand + "Lembrete ativado". The accessible name is constant
 * ("Lembrete da live {live}") and `aria-pressed` carries the state; the helper "Avisamos você 15
 * minutos antes do início." sits under it.
 *
 * **Write.** A tap flips the state at once (optimistic), sets `aria-busy` and ignores further taps
 * until the server action answers (`PUT` on, `DELETE` off). Success toasts the on / off sentence.
 * Every refusal reverts: `live_locked` and `reminder_closed` toast and `router.refresh()` into the
 * server's state, `gone` toasts and navigates to the lives list, anything else toasts the on / off
 * failure. The initial state is always the server's; the web keeps no local reminder store (E07).
 *
 * **Preview** (D-422, UI-D-459): disabled (off, `opacity-50` from the shipped geometry) with the hint
 * "Os lembretes não funcionam no modo aluno." in place of the helper, and no action is ever called.
 */
export function ReminderToggle({
  liveId,
  liveTitle,
  initialOn,
  preview,
  className,
}: ReminderToggleProps) {
  const t = useTranslations('courses.member.reminder');
  const toast = useToast();
  const router = useRouter();
  const [on, setOn] = useState(initialOn && !preview);
  const [busy, setBusy] = useState(false);
  // A ref, not the state: two taps inside one render must still send one request.
  const inFlight = useRef(false);

  async function toggle() {
    if (preview || inFlight.current) return;
    inFlight.current = true;
    const next = !on;
    setOn(next);
    setBusy(true);
    try {
      const result = await setLiveReminderAction(liveId, next);
      if (result.ok) {
        setOn(result.on);
        toast.show({ tone: 'success', message: t(next ? 'toasts.on' : 'toasts.off') });
        return;
      }
      setOn(!next);
      if (result.code === 'generic') {
        toast.show({ tone: 'error', message: t(next ? 'errors.on' : 'errors.off') });
        return;
      }
      toast.show({ tone: 'error', message: t(REFUSAL_KEY[result.code]) });
      if (result.code === 'gone') router.push(LIVES_HREF);
      else router.refresh();
    } catch {
      setOn(!next);
      toast.show({ tone: 'error', message: t(next ? 'errors.on' : 'errors.off') });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={t('aria', { live: liveTitle })}
        aria-busy={busy || undefined}
        disabled={preview}
        onClick={toggle}
        data-testid="reminder-toggle"
        data-state={on ? 'on' : 'off'}
        className={cn(
          buttonClasses({ variant: 'outline', size: 'md', fullWidth: true }),
          on && 'border-brand/30 bg-brand/10 hover:bg-brand/15',
        )}
      >
        {on ? (
          <BellRing aria-hidden size={18} className="shrink-0 text-brand" />
        ) : (
          <Bell aria-hidden size={18} className="shrink-0" />
        )}
        {on ? t('on') : t('off')}
      </button>
      <p data-testid="reminder-helper" className="mt-2 text-xs font-normal text-text-tertiary">
        {preview ? t('previewHint') : t('helper')}
      </p>
    </div>
  );
}
