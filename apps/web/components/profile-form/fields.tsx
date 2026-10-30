'use client';

import {
  type MemberQuestion,
  PROFILE_FORM_LIMITS,
  type ProfileFormIssue,
  type ProfileFormType,
} from '@rede-social/contracts/profile-form';
import { cn, Input, SegmentedControl, Textarea } from '@rede-social/ui';
import { ChevronDown, Eye, Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  type ChangeEvent,
  type ClipboardEvent,
  type ComponentProps,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  type ChoiceDraft,
  type Draft,
  emptyDraft,
  errorSpec,
  isChoiceDraft,
  settleOnBlur,
  validateOnBlur,
} from '@/lib/profile-form/form-state';
import {
  caretAfterDigits,
  onlyDigits,
  PHONE_MAX_DIGITS,
  parseBrazilianPhone,
  phoneMask,
} from '@/lib/profile-form/phone';

/**
 * The thirteen controls of the member's completion screen (12-12, D-590, UI-D-583, UI-D-584, UI-D-596).
 *
 * Every title, help text, option label and answer is React text: nothing here parses HTML or markdown
 * (UI-D-598). Every control is at least 44px tall with 16px text, every label is tied with `for`/`id` or
 * a `fieldset` + `legend`, a required question carries `aria-required` next to its visible caption, and an
 * error is tied to its control with `aria-describedby` and `aria-invalid`. The five format types
 * (number, date, phone, e-mail, link) share `useFormatField` (12-13): they are judged on blur with the
 * contract's own `parseAnswer`, never while the member types, and the error clears on the next edit.
 */

/** The ids one question's parts agree on. */
export interface FieldIds {
  control: string;
  label: string;
  help: string;
  notice: string;
  hint: string;
  error: string;
  /** The space-joined ids of the parts that exist, for `aria-describedby`. */
  describedBy: string | undefined;
}

export interface FieldProps {
  question: MemberQuestion;
  draft: Draft;
  onChange: (next: Draft) => void;
  /** Every control is locked while a save runs (UI-D-587). */
  disabled: boolean;
  /** The resolved error sentence, or `null`. */
  error: string | null;
  /** The resolved helper under a number control ("Entre 1 e 10."), or `null`. */
  hint: string | null;
  ids: FieldIds;
}

export type FieldComponent = (props: FieldProps) => ReactNode;

/** The value of the "Outro" entry of the dropdown (never an option id: those are UUIDs). */
const OTHER_VALUE = '__other__';

const CONTROL_CLASS =
  'w-full min-h-11 min-w-0 rounded-xl border border-border bg-bg-input px-4 py-3 text-base text-text transition-colors placeholder:text-text-tertiary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50';

function Caption({ required }: { required: boolean }) {
  const t = useTranslations('profileForm.member');
  return (
    <span
      className={cn(
        'shrink-0 text-xs',
        required ? 'font-bold text-text-secondary' : 'text-text-tertiary',
      )}
    >
      {required ? t('required') : t('optional')}
    </span>
  );
}

/** Help text and the public notice, only when the question has them (the notice is the API's flag). */
function Meta({ question, ids }: { question: MemberQuestion; ids: FieldIds }) {
  const t = useTranslations('profileForm.member');
  return (
    <>
      {question.helpText ? (
        <p id={ids.help} className="whitespace-pre-line break-words text-xs text-text-secondary">
          {question.helpText}
        </p>
      ) : null}
      {question.showOnProfile ? (
        <p id={ids.notice} className="flex items-center gap-1 text-xs text-text-tertiary">
          <Eye aria-hidden size={14} className="shrink-0" />
          {t('public')}
        </p>
      ) : null}
    </>
  );
}

function ErrorLine({ ids, error }: { ids: FieldIds; error: string | null }) {
  return error ? (
    <p id={ids.error} className="text-xs text-danger">
      {error}
    </p>
  ) : null;
}

function Hint({ ids, hint }: { ids: FieldIds; hint: string | null }) {
  return hint ? (
    <p id={ids.hint} className="text-xs text-text-tertiary">
      {hint}
    </p>
  ) : null;
}

/** The frame of a control named by a `label` (`for`/`id`). */
function LabelFrame({
  question,
  ids,
  children,
}: {
  question: MemberQuestion;
  ids: FieldIds;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <label
          htmlFor={ids.control}
          id={ids.label}
          className="min-w-0 break-words text-sm font-bold text-text"
        >
          {question.title}
        </label>
        <Caption required={question.required} />
      </div>
      <Meta question={question} ids={ids} />
      {children}
    </div>
  );
}

/** The frame of a group of controls: a `fieldset` named by its `legend` (UI-D-596). */
function GroupFrame({
  question,
  ids,
  role,
  error,
  children,
}: {
  question: MemberQuestion;
  ids: FieldIds;
  role?: 'radiogroup';
  error: string | null;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: UI-D-596 asks for the required state on every group, as a caption AND aria-required; the radiogroups support it natively and the checkbox group keeps it for the assistive tech that reads it
    <fieldset
      role={role}
      aria-required={question.required || undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={ids.describedBy}
      className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
    >
      <legend className="w-full p-0">
        <span className="flex items-start justify-between gap-3">
          <span id={ids.label} className="min-w-0 break-words text-sm font-bold text-text">
            {question.title}
          </span>
          <Caption required={question.required} />
        </span>
      </legend>
      <Meta question={question} ids={ids} />
      {children}
      <ErrorLine ids={ids} error={error} />
    </fieldset>
  );
}

/** "Limpar resposta": withdraws an OPTIONAL single answer once it is given (UI-D-584). */
function ClearButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  const t = useTranslations('profileForm.member');
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-11 self-start text-xs font-bold text-text-secondary hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
    >
      {t('controls.clear')}
    </button>
  );
}

function OptionRow({
  id,
  type,
  name,
  checked,
  label,
  disabled,
  onChange,
}: {
  id: string;
  type: 'radio' | 'checkbox';
  name: string;
  checked: boolean;
  label: string;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex min-h-11 items-start gap-3">
      <input
        id={id}
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-0.5 size-5 shrink-0 rounded border-border accent-brand"
      />
      <label htmlFor={id} className="min-w-0 break-words pt-0.5 text-sm text-text">
        {label}
      </label>
    </div>
  );
}

/** The "Qual?" text that follows a chosen "Outro" (UI-D-585): required once chosen, focus moves into it. */
function OtherInput({
  id,
  draft,
  disabled,
  focusRequested,
  onChange,
}: {
  id: string;
  draft: ChoiceDraft;
  disabled: boolean;
  focusRequested: boolean;
  onChange: (next: ChoiceDraft) => void;
}) {
  const t = useTranslations('profileForm.member');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusRequested) ref.current?.focus();
  }, [focusRequested]);
  return (
    <Input
      ref={ref}
      id={id}
      label={t('controls.other')}
      containerClassName="mt-2"
      value={draft.otherText}
      maxLength={PROFILE_FORM_LIMITS.otherText}
      disabled={disabled}
      aria-required="true"
      autoComplete="off"
      onChange={(event) => onChange({ ...draft, otherText: event.target.value })}
    />
  );
}

function asChoice(draft: Draft, type: ProfileFormType): ChoiceDraft {
  return isChoiceDraft(draft) ? draft : (emptyDraft(type) as ChoiceDraft);
}

function asText(draft: Draft): string {
  return typeof draft === 'string' ? draft : '';
}

/** A one-line text-like control; `type` and `inputMode` are what make the phone keyboards right. */
function TextLine({
  props,
  ...input
}: {
  props: FieldProps;
} & Partial<
  Pick<
    ComponentProps<typeof Input>,
    | 'type'
    | 'inputMode'
    | 'autoComplete'
    | 'autoCapitalize'
    | 'spellCheck'
    | 'placeholder'
    | 'maxLength'
    | 'min'
    | 'max'
    | 'enterKeyHint'
    | 'value'
    | 'onChange'
    | 'onBlur'
    | 'onPaste'
    | 'ref'
  >
>) {
  const { question, draft, onChange, disabled, error, hint, ids } = props;
  return (
    <LabelFrame question={question} ids={ids}>
      <Input
        id={ids.control}
        value={asText(draft)}
        disabled={disabled}
        error={error ?? undefined}
        aria-required={question.required || undefined}
        aria-describedby={ids.describedBy}
        className="min-h-11"
        onChange={(event) => onChange(event.target.value)}
        {...input}
      />
      <Hint ids={ids} hint={hint} />
    </LabelFrame>
  );
}

export const ShortText: FieldComponent = (props) => (
  <TextLine
    props={props}
    type="text"
    maxLength={PROFILE_FORM_LIMITS.shortText}
    autoComplete="off"
    enterKeyHint="next"
  />
);

export const LongText: FieldComponent = ({ question, draft, onChange, disabled, error, ids }) => (
  <LabelFrame question={question} ids={ids}>
    <Textarea
      id={ids.control}
      rows={4}
      value={asText(draft)}
      maxLength={PROFILE_FORM_LIMITS.longText}
      counter={{ value: asText(draft).length, max: PROFILE_FORM_LIMITS.longText }}
      disabled={disabled}
      error={error ?? undefined}
      aria-required={question.required || undefined}
      aria-describedby={[ids.describedBy, `${ids.control}-counter`].filter(Boolean).join(' ')}
      onChange={(event) => onChange(event.target.value)}
    />
  </LabelFrame>
);

/**
 * What the five format controls share (12-13, UI-D-586): the error the field shows is the save's (or the
 * server's) when there is one, else the one found when the member left the field; typing clears the
 * second at once; leaving the field settles the text the rules read (a number comes back in pt-BR form,
 * a link gets its `https://`) and judges it with the contract's `parseAnswer`.
 */
function useFormatField(props: FieldProps) {
  const t = useTranslations('profileForm.member');
  const { question, draft, onChange, error: saved, ids } = props;
  const [blurIssue, setBlurIssue] = useState<ProfileFormIssue | null>(null);
  const text = asText(draft);
  const spec = saved === null && blurIssue ? errorSpec(question, blurIssue) : null;
  const error = saved ?? (spec ? t(spec.key, spec.values) : null);
  const describedBy =
    [ids.describedBy, saved === null && error ? ids.error : null].filter(Boolean).join(' ') ||
    undefined;
  return {
    text,
    props: {
      ...props,
      error,
      ids: { ...ids, describedBy },
      onChange: (next: Draft) => {
        setBlurIssue(null);
        onChange(next);
      },
    } satisfies FieldProps,
    blur: () => {
      const settled = settleOnBlur(question, text);
      if (settled !== text) onChange(settled);
      setBlurIssue(validateOnBlur(question, settled));
    },
  };
}

export const NumberField: FieldComponent = (props) => {
  const f = useFormatField(props);
  return (
    <TextLine
      props={f.props}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      enterKeyHint="next"
      onBlur={f.blur}
    />
  );
};

export const DateField: FieldComponent = (props) => {
  const f = useFormatField(props);
  const { limits } = props.question;
  return (
    <TextLine
      props={f.props}
      type="date"
      min={typeof limits.min === 'string' ? limits.min : undefined}
      max={typeof limits.max === 'string' ? limits.max : undefined}
      onBlur={f.blur}
    />
  );
};

/**
 * The Brazilian phone: the draft holds the digits, the input shows the mask. A change that would need a
 * twelfth digit is refused (nothing the member typed is ever dropped), a `+55` or `55` country code is
 * removed only from a paste or a bulk insert into an empty field (a DDD 55 typed digit by digit is
 * left alone), and the caret stays next to the digit being edited.
 */
export const PhoneField: FieldComponent = (props) => {
  const t = useTranslations('profileForm.member');
  const f = useFormatField(props);
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const [, redraw] = useState(0);
  const digits = onlyDigits(f.text).slice(0, PHONE_MAX_DIGITS);
  const masked = phoneMask(digits);

  useLayoutEffect(() => {
    const count = caret.current;
    caret.current = null;
    const element = ref.current;
    if (count === null || element === null || document.activeElement !== element) return;
    const at = caretAfterDigits(masked, count);
    element.setSelectionRange(at, at);
  });

  function commit(next: string, count: number) {
    caret.current = count;
    if (next === digits) redraw((n) => n + 1);
    f.props.onChange(next);
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    const before = onlyDigits(raw.slice(0, event.target.selectionStart ?? raw.length)).length;
    const typed = onlyDigits(raw);
    if (digits === '' && (typed.length === 12 || typed.length === 13) && typed.startsWith('55')) {
      const national = parseBrazilianPhone(raw);
      commit(national, national.length);
    } else if (typed.length > PHONE_MAX_DIGITS) {
      commit(digits, Math.max(0, before - (typed.length - digits.length)));
    } else {
      commit(typed, before);
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pasted = parseBrazilianPhone(event.clipboardData.getData('text'));
    const { selectionStart, selectionEnd } = event.currentTarget;
    const from = onlyDigits(masked.slice(0, selectionStart ?? masked.length)).length;
    const to = onlyDigits(masked.slice(0, selectionEnd ?? masked.length)).length;
    const next = digits.slice(0, from) + pasted + digits.slice(to);
    if (next.length > PHONE_MAX_DIGITS) return;
    commit(next, from + pasted.length);
  }

  return (
    <TextLine
      props={f.props}
      ref={ref}
      type="tel"
      inputMode="tel"
      autoComplete="tel-national"
      enterKeyHint="next"
      placeholder={t('controls.phonePlaceholder')}
      value={masked}
      onChange={onChange}
      onPaste={onPaste}
      onBlur={f.blur}
    />
  );
};

export const EmailField: FieldComponent = (props) => {
  const t = useTranslations('profileForm.member');
  const f = useFormatField(props);
  return (
    <TextLine
      props={f.props}
      type="email"
      inputMode="email"
      autoComplete="email"
      autoCapitalize="off"
      enterKeyHint="next"
      placeholder={t('controls.emailPlaceholder')}
      onBlur={f.blur}
    />
  );
};

export const LinkField: FieldComponent = (props) => {
  const t = useTranslations('profileForm.member');
  const f = useFormatField(props);
  return (
    <TextLine
      props={f.props}
      type="url"
      inputMode="url"
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      enterKeyHint="next"
      placeholder={t('controls.linkPlaceholder')}
      onBlur={f.blur}
    />
  );
};

export const Dropdown: FieldComponent = ({ question, draft, onChange, disabled, error, ids }) => {
  const t = useTranslations('profileForm.member');
  const choice = asChoice(draft, question.type);
  const [focusOther, setFocusOther] = useState(false);
  const answered = choice.other || choice.optionIds.length > 0;
  const value = choice.other ? OTHER_VALUE : (choice.optionIds[0] ?? '');
  return (
    <LabelFrame question={question} ids={ids}>
      <div className="relative">
        <select
          id={ids.control}
          value={value}
          disabled={disabled}
          aria-required={question.required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className={cn(CONTROL_CLASS, 'appearance-none pr-10', error && 'border-danger')}
          onChange={(event) => {
            const picked = event.target.value;
            if (picked === OTHER_VALUE) {
              setFocusOther(true);
              onChange({ optionIds: [], other: true, otherText: choice.otherText });
            } else {
              setFocusOther(false);
              onChange({ optionIds: picked === '' ? [] : [picked], other: false, otherText: '' });
            }
          }}
        >
          <option value="" disabled>
            {t('controls.select')}
          </option>
          {question.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
          {question.allowOther ? (
            <option value={OTHER_VALUE}>{t('controls.otherOption')}</option>
          ) : null}
        </select>
        <ChevronDown
          aria-hidden
          size={18}
          className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-text-tertiary"
        />
      </div>
      {choice.other ? (
        <OtherInput
          id={`${ids.control}-other`}
          draft={choice}
          disabled={disabled}
          focusRequested={focusOther}
          onChange={onChange}
        />
      ) : null}
      <ErrorLine ids={ids} error={error} />
      {!question.required && answered ? (
        <ClearButton disabled={disabled} onClick={() => onChange(emptyDraft(question.type))} />
      ) : null}
    </LabelFrame>
  );
};

export const SingleChoice: FieldComponent = ({
  question,
  draft,
  onChange,
  disabled,
  error,
  ids,
}) => {
  const choice = asChoice(draft, question.type);
  const t = useTranslations('profileForm.member');
  const [focusOther, setFocusOther] = useState(false);
  const name = `${ids.control}-group`;
  const answered = choice.other || choice.optionIds.length > 0;
  return (
    <GroupFrame question={question} ids={ids} role="radiogroup" error={error}>
      {question.options.map((option) => (
        <OptionRow
          key={option.id}
          id={`${ids.control}-${option.id}`}
          type="radio"
          name={name}
          checked={!choice.other && choice.optionIds[0] === option.id}
          label={option.label}
          disabled={disabled}
          onChange={() => {
            setFocusOther(false);
            onChange({ optionIds: [option.id], other: false, otherText: '' });
          }}
        />
      ))}
      {question.allowOther ? (
        <OptionRow
          id={`${ids.control}-other-option`}
          type="radio"
          name={name}
          checked={choice.other}
          label={t('controls.otherOption')}
          disabled={disabled}
          onChange={() => {
            setFocusOther(true);
            onChange({ optionIds: [], other: true, otherText: choice.otherText });
          }}
        />
      ) : null}
      {choice.other ? (
        <OtherInput
          id={`${ids.control}-other`}
          draft={choice}
          disabled={disabled}
          focusRequested={focusOther}
          onChange={onChange}
        />
      ) : null}
      {!question.required && answered ? (
        <ClearButton disabled={disabled} onClick={() => onChange(emptyDraft(question.type))} />
      ) : null}
    </GroupFrame>
  );
};

export const MultipleChoice: FieldComponent = ({
  question,
  draft,
  onChange,
  disabled,
  error,
  ids,
}) => {
  const choice = asChoice(draft, question.type);
  const t = useTranslations('profileForm.member');
  const [focusOther, setFocusOther] = useState(false);
  const name = `${ids.control}-group`;
  const toggle = (id: string) => {
    const has = choice.optionIds.includes(id);
    onChange({
      ...choice,
      optionIds: has ? choice.optionIds.filter((x) => x !== id) : [...choice.optionIds, id],
    });
  };
  return (
    <GroupFrame question={question} ids={ids} error={error}>
      {question.options.map((option) => (
        <OptionRow
          key={option.id}
          id={`${ids.control}-${option.id}`}
          type="checkbox"
          name={name}
          checked={choice.optionIds.includes(option.id)}
          label={option.label}
          disabled={disabled}
          onChange={() => toggle(option.id)}
        />
      ))}
      {question.allowOther ? (
        <OptionRow
          id={`${ids.control}-other-option`}
          type="checkbox"
          name={name}
          checked={choice.other}
          label={t('controls.otherOption')}
          disabled={disabled}
          onChange={() => {
            setFocusOther(!choice.other);
            onChange({ ...choice, other: !choice.other });
          }}
        />
      ) : null}
      {choice.other ? (
        <OtherInput
          id={`${ids.control}-other`}
          draft={choice}
          disabled={disabled}
          focusRequested={focusOther}
          onChange={onChange}
        />
      ) : null}
    </GroupFrame>
  );
};

export const YesNo: FieldComponent = ({ question, draft, onChange, disabled, error, ids }) => {
  const t = useTranslations('profileForm.member');
  const value = draft === true ? 'yes' : draft === false ? 'no' : null;
  return (
    <GroupFrame question={question} ids={ids} error={error}>
      <SegmentedControl
        labelId={ids.label}
        options={[
          { value: 'yes', label: t('controls.yes') },
          { value: 'no', label: t('controls.no') },
        ]}
        value={value}
        disabled={disabled}
        onChange={(next) => onChange(next === 'yes')}
      />
      {!question.required && value !== null ? (
        <ClearButton disabled={disabled} onClick={() => onChange(null)} />
      ) : null}
    </GroupFrame>
  );
};

export const Acceptance: FieldComponent = ({ question, draft, onChange, disabled, error, ids }) => (
  <div className="flex flex-col gap-2">
    <div className="flex min-h-11 items-start gap-3">
      <input
        id={ids.control}
        type="checkbox"
        checked={draft === true}
        disabled={disabled}
        aria-required={question.required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-5 shrink-0 rounded border-border accent-brand"
      />
      <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
        <label
          htmlFor={ids.control}
          id={ids.label}
          className="min-w-0 break-words text-sm font-bold text-text"
        >
          {question.title}
        </label>
        <Caption required={question.required} />
      </div>
    </div>
    <Meta question={question} ids={ids} />
    <ErrorLine ids={ids} error={error} />
  </div>
);

export const Rating: FieldComponent = ({ question, draft, onChange, disabled, error, ids }) => {
  const t = useTranslations('profileForm.member');
  const value = typeof draft === 'number' ? draft : null;
  return (
    <GroupFrame question={question} ids={ids} role="radiogroup" error={error}>
      <div className="flex flex-wrap items-center gap-x-3">
        <div className="flex items-center">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              htmlFor={`${ids.control}-${n}`}
              className="flex size-11 cursor-pointer items-center justify-center rounded-xl has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand"
            >
              <input
                id={`${ids.control}-${n}`}
                type="radio"
                name={`${ids.control}-group`}
                className="sr-only"
                checked={value === n}
                disabled={disabled}
                onChange={() => onChange(n)}
              />
              <Star
                aria-hidden
                size={24}
                className={cn(
                  value !== null && n <= value
                    ? 'fill-brand text-brand'
                    : 'fill-transparent text-text-tertiary',
                )}
              />
              <span className="sr-only">{t('controls.star', { n })}</span>
            </label>
          ))}
        </div>
        {value !== null ? (
          <span className="text-xs text-text-secondary">
            {t('controls.ratingOf', { n: value })}
          </span>
        ) : null}
      </div>
      {!question.required && value !== null ? (
        <ClearButton disabled={disabled} onClick={() => onChange(null)} />
      ) : null}
    </GroupFrame>
  );
};
