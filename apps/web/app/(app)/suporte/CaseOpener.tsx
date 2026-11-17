'use client';

import { CHAT_CASE_CATEGORIES, type ChatCaseCategory } from '@rede-social/module-chat/contracts';
import { Chip, Input } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

/**
 * The first-message opener (UI-D-819, D-811, D-812) [designed]: the member's one chance to classify the
 * case they are about to open. Drawn inside the thread's scroller under the greeting and above the pinned
 * composer, so a phone keyboard shrinks the scroller and the opener scrolls instead of eating the screen.
 *
 * **Controlled** (checker W17): the thread pane owns the two values and the composer's send closes over
 * them, so this holds no send logic. A tap on a chip or a keystroke in the subject reports the whole new
 * pair through `onChange`; the subject is ABSENT (`undefined`) when empty, so the send never carries a
 * blank one.
 *
 * - The five category chips are shipped `Chip` buttons (`aria-pressed`) in a `role="group"` named by the
 *   caption. They wrap to a second line at 320 and 390 px and never scroll sideways, so all five stay
 *   visible. Exactly one is always selected: tapping the pressed one keeps it.
 * - The subject is the shipped `Input`: 16px (the iOS zoom guard), `maxLength` 80, no counter, no growth.
 *
 * Every word is the `chat` catalog's; the category list is the closed list of the contract, in its
 * fixed order.
 */

export interface CaseOpenerValue {
  category: ChatCaseCategory;
  /** Absent when the field is empty. */
  subject?: string;
}

export interface CaseOpenerProps extends CaseOpenerValue {
  onChange: (next: CaseOpenerValue) => void;
}

/** The subject's cap, the same 80 the API enforces (`CHAT_SUBJECT_MAX`, A-UI-19). */
const SUBJECT_MAX_LENGTH = 80;

const CATEGORY_KEY: Record<ChatCaseCategory, string> = {
  check_in: 'category.checkIn',
  events: 'category.events',
  payment: 'category.payment',
  account: 'category.account',
  other: 'category.other',
};

export function CaseOpener({ category, subject, onChange }: CaseOpenerProps) {
  const t = useTranslations('chat');
  const uid = useId();
  const captionId = `${uid}-caption`;

  return (
    <div data-case-opener className="flex flex-col gap-2 px-4 pb-4">
      <p id={captionId} className="text-xs font-bold text-text-secondary">
        {t('open.category')}
      </p>
      <fieldset aria-labelledby={captionId} className="flex min-w-0 flex-wrap gap-2">
        {CHAT_CASE_CATEGORIES.map((value) => (
          <Chip
            key={value}
            active={value === category}
            onClick={() => onChange({ category: value, subject })}
          >
            {t(CATEGORY_KEY[value])}
          </Chip>
        ))}
      </fieldset>
      <Input
        id={`${uid}-subject`}
        label={t('open.subject.label')}
        placeholder={t('open.subject.placeholder')}
        maxLength={SUBJECT_MAX_LENGTH}
        autoComplete="off"
        value={subject ?? ''}
        onChange={(event) =>
          onChange({
            category,
            subject: event.target.value === '' ? undefined : event.target.value,
          })
        }
      />
    </div>
  );
}
