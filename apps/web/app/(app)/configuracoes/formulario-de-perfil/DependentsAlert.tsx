'use client';

import type { Dependent } from '@rede-social/contracts/profile-form';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import type { DependentGroup, RefusalKind } from './editor-state';

/** The most titles the alert lists before "e mais N", in total across the groups (UI-D-651, UI-D-673). */
export const DEPENDENTS_SHOWN = 5;

/**
 * The refusals of the opener edits (archive, delete, retype, one option), the privacy refusal (a public question
 * under a private opener, WR-06), plus "Arquivar ramo" refused over openers of branches with answers.
 */
export type DependentsAlertKind = RefusalKind | 'archiveBranch';

export interface DependentsAlertProps {
  /** Which edit was refused: archive, delete, retype, removing one of the options, or the privacy rule. */
  kind: DependentsAlertKind;
  /** A flat list of titles: the openers of "Arquivar ramo", or the public questions of the privacy rule. */
  dependents?: readonly Dependent[];
  /**
   * 12.2-18 (D-646, UI-D-673): the branches that block an opener edit, each with the titles of its questions: the
   * client's own list, or the server's 409 `details.branches` (a race). When present it replaces `dependents`.
   */
  groups?: readonly DependentGroup[];
  /** The option's label, for `kind="option"` only. */
  label?: string;
}

/** The catalog key of the hint under the title, selected by the kind (UI-D-673, UI-D-675). */
function hintKey(kind: DependentsAlertKind): string {
  switch (kind) {
    case 'option':
      return 'dependents.hintOptionBranches';
    case 'archiveBranch':
      return 'dependents.hintArchiveBranch';
    case 'privacy':
      return 'dependents.hintPrivacy';
    default:
      return 'dependents.hintBranches';
  }
}

/**
 * The one refusal list for the edits an opener, a branch or a privacy switch refuses (12.1-17, D-632; 12.2-18,
 * D-646, UI-D-673): an alert role, the 09.4 sheet-alert geometry, a 14/700 title that says what cannot be done, a
 * 12/400 hint that says what to do first, and the list. With `groups` each branch is a 12/700 line (its label,
 * which wraps) above a plain `ul` of its question titles; **up to five titles in total across the groups**, then
 * "e mais N" for the rest, and a branch with no question (or one whose titles the five already used) shows its
 * label only. With a flat `dependents` it is the one `ul` of titles. It renders inside the sheet, above the
 * footer, so a refusal that has a list is never a bare toast. Labels and titles are admin-typed, so they are
 * React text with `break-words`, never HTML (T-12.1-12, T-12.2-15). It renders nothing when there is nothing to
 * list: a refusal always names at least one thing.
 */
export function DependentsAlert({
  kind,
  dependents = [],
  groups = [],
  label = '',
}: DependentsAlertProps) {
  const t = useTranslations('profileForm.admin');
  const id = useId();
  const grouped = groups.length > 0;
  if (!grouped && dependents.length === 0) return null;

  let room = DEPENDENTS_SHOWN;
  const drawn = groups.map((group) => {
    const shown = group.questions.slice(0, room);
    room -= shown.length;
    return { group, shown };
  });
  const flat = dependents.slice(0, DEPENDENTS_SHOWN);
  const total = grouped
    ? groups.reduce((sum, group) => sum + group.questions.length, 0)
    : dependents.length;
  const shownCount = grouped ? DEPENDENTS_SHOWN - room : flat.length;
  const more = total - shownCount;

  return (
    <div
      role="alert"
      data-dependents-alert={kind}
      className="flex flex-col gap-2 rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger"
    >
      <span className="break-words text-sm font-bold">
        {t(`dependents.title.${kind}`, { label })}
      </span>
      <span className="text-xs font-normal text-text-secondary">{t(hintKey(kind))}</span>
      {grouped ? (
        drawn.map(({ group, shown }) => {
          const labelId = `${id}-${group.id}`;
          return (
            <div key={group.id} className="flex flex-col gap-1">
              <span id={labelId} className="break-words text-xs font-bold text-text">
                {group.label}
              </span>
              {shown.length > 0 ? (
                <ul
                  aria-labelledby={labelId}
                  className="flex list-disc flex-col gap-1 pl-4 text-sm text-text"
                >
                  {shown.map((question) => (
                    <li key={question.id} className="break-words">
                      {question.title}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })
      ) : (
        <ul
          aria-label={t('editor.opens.listLabel')}
          className="flex list-disc flex-col gap-1 pl-4 text-sm text-text"
        >
          {flat.map((dependent) => (
            <li key={dependent.id} className="break-words">
              {dependent.title}
            </li>
          ))}
        </ul>
      )}
      {more > 0 ? (
        <span className="text-xs font-normal text-text-secondary">
          {t('dependents.more', { count: more })}
        </span>
      ) : null}
    </div>
  );
}
