'use client';

import type {
  MemberQuestion,
  ProfileFormIssue,
  ProfileFormType,
} from '@rede-social/contracts/profile-form';
import { cn } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type Draft, errorSpec, limitHint } from '@/lib/profile-form/form-state';
import {
  Acceptance,
  DateField,
  Dropdown,
  EmailField,
  type FieldComponent,
  type FieldIds,
  LinkField,
  LongText,
  MultipleChoice,
  NumberField,
  PhoneField,
  ProfessionalIdField,
  Rating,
  ShortText,
  SingleChoice,
  YesNo,
} from './fields';

/**
 * One control per type, exhaustive by construction (D-591): a new entry in `PROFILE_FORM_TYPES` fails
 * to compile here until it has a control.
 */
export const FIELD_BY_TYPE: Record<ProfileFormType, FieldComponent> = {
  short_text: ShortText,
  long_text: LongText,
  dropdown: Dropdown,
  multiple_choice: MultipleChoice,
  single_choice: SingleChoice,
  number: NumberField,
  date: DateField,
  phone: PhoneField,
  email: EmailField,
  link: LinkField,
  yes_no: YesNo,
  acceptance: Acceptance,
  rating: Rating,
  professional_id: ProfessionalIdField,
};

/** The DOM id of the wrapper of a question (the in-page links and the focus jumps point at it). */
export const questionDomId = (questionId: string) => `pf-q-${questionId}`;

function buildIds(question: MemberQuestion, parts: { hint: boolean; error: boolean }): FieldIds {
  const base = `pf-${question.id}`;
  const ids = {
    control: `${base}-control`,
    label: `${base}-label`,
    help: `${base}-help`,
    notice: `${base}-notice`,
    hint: `${base}-hint`,
    error: `${base}-control-error`,
  };
  const described = [
    question.helpText ? ids.help : null,
    question.showOnProfile ? ids.notice : null,
    parts.hint ? ids.hint : null,
    parts.error ? ids.error : null,
  ].filter((id): id is string => id !== null);
  return { ...ids, describedBy: described.length > 0 ? described.join(' ') : undefined };
}

export interface QuestionFieldProps {
  question: MemberQuestion;
  draft: Draft;
  onChange: (next: Draft) => void;
  disabled: boolean;
  /** The refusal on this question (client rule or the API's keyed error), or `null`. */
  issue: ProfileFormIssue | null;
  /** A missing required question gets the danger-tinted block and "Falta responder" (UI-D-582). */
  flagged: boolean;
}

/**
 * A question of the completion screen: the wrapper, the flag and the control of its type. The title,
 * caption, help text, public notice and error line are drawn by the control (they are tied to it with
 * `for`/`id` or `fieldset` + `legend`), so the wrapper only adds the missing-answer block. It is always a plain
 * field: the reveal of a branch's questions is the block's (`RevealedBranch`, 12.2-14, UI-D-679).
 */
export function QuestionField({
  question,
  draft,
  onChange,
  disabled,
  issue,
  flagged,
}: QuestionFieldProps) {
  const t = useTranslations('profileForm.member');
  const Field = FIELD_BY_TYPE[question.type];
  const hintSpec = limitHint(question);
  const hint = hintSpec ? t(hintSpec.key, hintSpec.values) : null;
  const spec = issue ? errorSpec(question, issue) : null;
  const error = spec ? t(spec.key, spec.values) : null;
  const ids = buildIds(question, { hint: hint !== null, error: error !== null });

  return (
    <div
      id={questionDomId(question.id)}
      data-question={question.id}
      data-flagged={flagged || undefined}
      className={cn('scroll-mt-4', flagged && 'rounded-xl border border-danger/40 bg-danger/5 p-4')}
    >
      {flagged ? (
        <p className="mb-2 flex items-center gap-1 text-xs font-bold text-danger">
          <CircleAlert aria-hidden size={14} className="shrink-0" />
          {t('flag')}
        </p>
      ) : null}
      <Field
        question={question}
        draft={draft}
        onChange={onChange}
        disabled={disabled}
        error={error}
        hint={hint}
        ids={ids}
      />
    </div>
  );
}
