'use client';

import { Button, buttonClasses, Card, useToast } from '@rede-social/ui';
import { ClipboardList } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { dismissNoticeAction } from '@/app/(app)/perfil/profile-form-actions';

/** Where "Responder" goes: the completion screen, returning to the profile (UI-D-589). */
const ANSWER_HREF = '/completar-perfil?next=%2Fperfil';

export interface NewQuestionsNoticeProps {
  /** The tenant's display name, rendered as text in the sentence. */
  tenantName: string;
  /** How many optional questions are new for this member (`bootstrap.profileForm.newOptional`, above 0). */
  count: number;
}

/**
 * The "Há perguntas novas no seu perfil" notice of `/perfil` (12-14, D-586, UI-D-589; PFORM-16 web half).
 *
 * A `Card` in the `ProfileCompletenessCard` mould (a 40px disc, a title, a line and a button row) with a
 * NEUTRAL disc, so the two cards are never confused: only the completeness card has a brand button.
 * "Responder" opens the completion screen and returns here. "Agora não" dismisses ON THE SERVER (it
 * survives a reinstall and every other device): the notice leaves at once (optimistic), and if the write
 * fails it comes back with a toast, so the member is never told it is gone when it will return.
 *
 * The page renders it for the member role only, with the module on and `newOptional > 0`; it never shows
 * for a required question (those gate), for staff, or with nothing new. Nothing a member typed is read or
 * stored here.
 */
export function NewQuestionsNotice({ tenantName, count }: NewQuestionsNoticeProps) {
  const t = useTranslations('profileForm.profile.newQuestions');
  const toast = useToast();
  const [hidden, setHidden] = useState(false);

  async function dismiss() {
    setHidden(true);
    let ok = false;
    try {
      ok = (await dismissNoticeAction()).ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      setHidden(false);
      toast.show({ tone: 'error', message: t('dismissFailed') });
    }
  }

  if (hidden) return null;

  return (
    <Card data-new-questions-notice className="flex items-start gap-3 p-4">
      <span
        aria-hidden
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-text-secondary"
      >
        <ClipboardList size={20} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="text-sm font-bold text-text">{t('title')}</h3>
        <p className="text-xs font-normal text-text-secondary">
          {t('body', { tenant: tenantName, count })}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link
            href={ANSWER_HREF}
            className={buttonClasses({ variant: 'outline', size: 'sm', hitArea: true })}
          >
            {t('answer')}
          </Link>
          <Button variant="ghost" size="sm" hitArea onClick={dismiss}>
            {t('dismiss')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
