'use client';

import type { AdminQuestion, AdminStep } from '@rede-social/contracts/profile-form';
import { Button, SegmentedControl, Switch } from '@rede-social/ui';
import { ChevronDown, Info, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef } from 'react';
import type { DraftCondition } from './editor-state';

export const CONDITION_SWITCH_ID = 'pf-condition';
export const CONDITION_OPENER_ID = 'pf-condition-opener';
const VALUES_LEGEND_ID = 'pf-condition-legend';
const VALUES_ERROR_ID = 'pf-condition-values-error';

const SELECT_CLASS =
  'w-full min-h-11 min-w-0 appearance-none rounded-xl border border-border bg-bg-input px-4 py-3 pr-10 text-base text-text transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50';

export interface SheetSelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The line under the field (`role="alert"`): the select is `aria-invalid` and described by it. */
  error?: string;
  /** The helper under the field, linked with `aria-describedby`. */
  helper?: string;
  disabled?: boolean;
  children: ReactNode;
}

/**
 * A native `<select>` in the shipped `Input` look (UI-D-647, UI-D-648): the label above (14/400 secondary), the
 * 16px control with a trailing `ChevronDown` 18, a 12/400 tertiary helper and a `role="alert"` error line. Native
 * on purpose: nothing a phone's own picker already does is rebuilt here.
 */
export function SheetSelect({
  id,
  label,
  value,
  onChange,
  error,
  helper,
  disabled,
  children,
}: SheetSelectProps) {
  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;
  // A change the owner refuses leaves its value as it was, and the control must show that: the native element
  // already took the picked option, so it is put back to the controlled value after every render (the snap-back
  // of the step field, UI-D-647).
  const element = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (element.current && element.current.value !== value) element.current.value = value;
  });
  // The error replaces the helper (the sketch draws one or the other), and the field is described by what shows.
  const shownHelper = error ? undefined : helper;
  const describedBy = [error ? errorId : null, shownHelper ? helperId : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-normal text-text-secondary">
        {label}
      </label>
      <div className="relative">
        <select
          ref={element}
          id={id}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={error ? `${SELECT_CLASS} border-danger` : SELECT_CLASS}
          onChange={(event) => onChange(event.target.value)}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          size={18}
          className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-text-tertiary"
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="break-words text-sm text-danger">
          {error}
        </p>
      ) : null}
      {shownHelper ? (
        <span id={helperId} className="text-xs font-normal text-text-tertiary">
          {shownHelper}
        </span>
      ) : null}
    </div>
  );
}

export interface ConditionEditorProps {
  /** The draft condition: `null` is "always shown"; an empty `questionId` is "switch on, opener not chosen yet". */
  condition: DraftCondition | null;
  /** The eligible openers, already filtered and in form order (`eligibleOpeners`). */
  openers: AdminQuestion[];
  steps: AdminStep[];
  /** A required question adds the "só quem a vê precisa responder" line. */
  required: boolean;
  openerError?: string;
  valuesError?: string;
  /** The server said the opener changed meanwhile (409 `condition_invalid`). */
  stale?: boolean;
  /** The editor cleared the answers because the opener changed: said politely, in a status line. */
  resetNote?: boolean;
  /** `reset` is true when the answers were cleared because a different opener was chosen. */
  onChange: (condition: DraftCondition | null, reset?: boolean) => void;
}

/**
 * The condition editor of the question sheet (12.1-17, D-620..D-623, UI-D-648): a `Switch` row "Mostrar só em
 * alguns casos"; on, a native `select` "Pergunta que decide" listing ONLY the eligible openers (grouped by
 * step with two or more steps) and a value picker that follows the opener's type: the shipped
 * `SegmentedControl` Sim or Não for yes/no, a `fieldset` of 44px checkbox rows in the opener's own order for a
 * choice type (at least one ticked: any one of them opens the question). With no eligible opener the switch is
 * disabled and a note row says what to create first. Turning the switch on moves focus into the `select`;
 * turning it off discards the draft. Every title and label is React text (T-12.1-12).
 *
 * The server is the authority: it refuses an opener this list would never offer, and a condition whose opener
 * changed meanwhile comes back as 409 `condition_invalid` (the `stale` line).
 */
export function ConditionEditor({
  condition,
  openers,
  steps,
  required,
  openerError,
  valuesError,
  stale = false,
  resetNote = false,
  onChange,
}: ConditionEditorProps) {
  const te = useTranslations('profileForm.admin.editor');
  const tc = useTranslations('profileForm.member.controls');
  const on = condition !== null;
  const noOpeners = openers.length === 0 && !on;

  // Turning the switch on moves focus into the opener select, once it exists.
  const focusOpener = useRef(false);
  useEffect(() => {
    if (!focusOpener.current || condition === null) return;
    focusOpener.current = false;
    document.getElementById(CONDITION_OPENER_ID)?.focus();
  }, [condition]);

  const opener = condition
    ? openers.find((candidate) => candidate.id === condition.questionId)
    : undefined;

  function toggle(next: boolean) {
    if (next) {
      focusOpener.current = true;
      onChange({ questionId: '', values: [] });
    } else {
      onChange(null);
    }
  }

  function chooseOpener(id: string) {
    if (condition === null || id === condition.questionId) return;
    // Choosing the first opener clears nothing worth saying; changing one that was chosen does.
    onChange({ questionId: id, values: [] }, condition.questionId !== '');
  }

  function toggleOption(optionId: string, checked: boolean) {
    if (condition === null || !opener) return;
    const wanted = new Set(condition.values);
    if (checked) wanted.add(optionId);
    else wanted.delete(optionId);
    // The tokens keep the opener's own order, whatever order they were ticked in.
    onChange({
      questionId: condition.questionId,
      values: opener.options.map((option) => option.id).filter((id) => wanted.has(id)),
    });
  }

  const grouped = steps.length >= 2;
  const optionOf = (question: AdminQuestion) => (
    <option key={question.id} value={question.id}>
      {question.title}
    </option>
  );

  return (
    <div className="flex flex-col gap-4" data-condition-editor>
      <div className="flex min-h-11 items-start justify-between gap-3 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="break-words text-sm font-bold text-text">{te('condition.label')}</span>
          <span
            id={`${CONDITION_SWITCH_ID}-helper`}
            className="text-xs font-normal text-text-tertiary"
          >
            {te('condition.helper')}
          </span>
        </div>
        <Switch
          id={CONDITION_SWITCH_ID}
          label={te('condition.label')}
          aria-describedby={`${CONDITION_SWITCH_ID}-helper`}
          checked={on}
          disabled={noOpeners}
          onChange={toggle}
        />
      </div>

      {noOpeners ? (
        <div
          role="status"
          data-condition-none
          className="flex items-start gap-2 rounded-xl bg-bg-tertiary px-3 py-3 text-xs font-normal text-text"
        >
          <Info aria-hidden size={16} className="mt-px shrink-0 text-text-secondary" />
          <span className="min-w-0 flex-1 break-words">{te('condition.none')}</span>
        </div>
      ) : null}

      {condition ? (
        <>
          <SheetSelect
            id={CONDITION_OPENER_ID}
            label={te('condition.opener.label')}
            value={condition.questionId}
            onChange={chooseOpener}
            error={openerError}
            helper={te('condition.opener.help')}
          >
            <option value="" disabled>
              {te('condition.opener.placeholder')}
            </option>
            {grouped
              ? steps.map((step) => {
                  const inStep = openers.filter((candidate) => candidate.stepId === step.id);
                  return inStep.length === 0 ? null : (
                    <optgroup key={step.id} label={step.title}>
                      {inStep.map(optionOf)}
                    </optgroup>
                  );
                })
              : openers.map(optionOf)}
          </SheetSelect>

          <div role="status" data-condition-reset>
            {resetNote ? (
              <p className="text-xs font-normal text-text-tertiary">{te('condition.reset')}</p>
            ) : null}
          </div>

          {stale ? (
            <p role="alert" data-condition-stale className="break-words text-sm text-danger">
              {te('condition.errors.stale')}
            </p>
          ) : null}

          {opener?.type === 'yes_no' ? (
            <div className="flex min-w-0 flex-col gap-2" data-condition-values>
              {/* The legend of the shipped control: the group it draws is named by this line, so no second
                  fieldset repeats the name to a screen reader. */}
              <p id={VALUES_LEGEND_ID} className="mb-2 text-sm font-bold text-text">
                {te('condition.values.legend')}
              </p>
              <SegmentedControl
                labelId={VALUES_LEGEND_ID}
                options={[
                  { value: 'true', label: tc('yes') },
                  { value: 'false', label: tc('no') },
                ]}
                value={condition.values[0] ?? null}
                onChange={(value) =>
                  onChange({ questionId: condition.questionId, values: [value] })
                }
              />
              {valuesError ? (
                <p id={VALUES_ERROR_ID} role="alert" className="text-sm text-danger">
                  {valuesError}
                </p>
              ) : null}
            </div>
          ) : opener ? (
            <fieldset
              className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
              aria-describedby={valuesError ? VALUES_ERROR_ID : undefined}
              data-condition-values
            >
              <legend id={VALUES_LEGEND_ID} className="mb-2 p-0 text-sm font-bold text-text">
                {te('condition.values.legend')}
              </legend>
              {opener.options.map((option) => {
                const id = `pf-condition-value-${option.id}`;
                return (
                  <div key={option.id} className="flex min-h-11 items-center gap-3">
                    <input
                      id={id}
                      type="checkbox"
                      checked={condition.values.includes(option.id)}
                      aria-invalid={valuesError ? true : undefined}
                      onChange={(event) => toggleOption(option.id, event.target.checked)}
                      className="size-5 shrink-0 rounded border-border accent-brand"
                    />
                    <label htmlFor={id} className="min-w-0 flex-1 break-words text-sm text-text">
                      {option.label}
                    </label>
                  </div>
                );
              })}
              {valuesError ? (
                <p id={VALUES_ERROR_ID} role="alert" className="text-sm text-danger">
                  {valuesError}
                </p>
              ) : null}
              <span className="text-xs font-normal text-text-tertiary">
                {te('condition.values.help')}
              </span>
              {opener.allowOther ? (
                <span className="text-xs font-normal text-text-tertiary">
                  {te('condition.values.otherNote')}
                </span>
              ) : null}
            </fieldset>
          ) : null}

          {required ? (
            <p className="text-xs font-normal text-text-tertiary">{te('condition.requiredNote')}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export interface LockedConditionProps {
  /** How many answers the question has: the plural of the lock sentence. */
  answerCount: number;
  /**
   * The stored condition as the "Só aparece se …" sentence, `null` when the question has none, or `''` when the
   * sentence cannot be built (the opener is not in the list the page holds): the lock row is then left out.
   */
  summary: string | null;
  /** The removal is marked in the draft and not yet saved. */
  removing: boolean;
  onRemove: () => void;
  onUndo: () => void;
  /** "Criar nova pergunta e arquivar esta": the shipped replace flow. Without it the way out is not offered. */
  onReplace?: () => void;
}

/**
 * The condition block of a question that already has answers (12.1-17, D-625, UI-D-649): the condition cannot be
 * created or changed, because that would change who owes an answer retroactively; it can only be REMOVED, which
 * widens who sees the question and deletes nothing. With no condition the switch is replaced by a read-only row
 * (`Lock` 16) and the one-tap way out, "Criar nova pergunta e arquivar esta". With a condition the row shows the
 * sentence and the ghost "Remover condição", which only MARKS the draft ("A condição será removida quando você
 * salvar." with "Desfazer"); nothing is written until "Salvar pergunta". The server repeats the lock (409).
 */
export function LockedCondition({
  answerCount,
  summary,
  removing,
  onRemove,
  onUndo,
  onReplace,
}: LockedConditionProps) {
  const te = useTranslations('profileForm.admin.editor');
  const lockRow = (text: string) => (
    <p className="flex items-start gap-2 break-words text-xs font-normal text-text-secondary">
      <Lock aria-hidden size={16} className="mt-px shrink-0 text-text-tertiary" />
      <span className="min-w-0 flex-1">{text}</span>
    </p>
  );

  if (summary === null) {
    return (
      <div className="flex flex-col gap-3" data-condition-locked="none">
        {lockRow(te('condition.locked.none', { n: answerCount }))}
        {onReplace ? (
          <Button variant="outline" fullWidth onClick={onReplace}>
            {te('locked.replace')}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-condition-locked="removable">
      {summary !== '' ? lockRow(summary) : null}
      {removing ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-normal text-text-secondary">
          <span data-condition-removing>{te('condition.removePending')}</span>
          <Button variant="ghost" size="sm" hitArea onClick={onUndo}>
            {te('condition.undo')}
          </Button>
        </div>
      ) : (
        <>
          <p className="text-xs font-normal text-text-tertiary">
            {te('condition.locked.removable')}
          </p>
          <div>
            <Button variant="ghost" size="sm" hitArea onClick={onRemove}>
              {te('condition.remove')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
