'use client';

import type { Dependent } from '@rede-social/contracts/profile-form';
import { useTranslations } from 'next-intl';
import type { RefusalKind } from './editor-state';

/** The most titles the alert lists before "e mais N" (UI-D-651). */
export const DEPENDENTS_SHOWN = 5;

/** The refusals of the opener edits, plus "Arquivar ramo" refused over openers of branches with answers. */
export type DependentsAlertKind = RefusalKind | 'archiveBranch';

export interface DependentsAlertProps {
  /** Which edit the opener refused: archive, delete, retype, or removing one of its options. */
  kind: DependentsAlertKind;
  /** The questions that block it: the client's own list, or the server's 409 `dependents` (a race). */
  dependents: readonly Dependent[];
  /** The option's label, for `kind="option"` only. */
  label?: string;
}

/**
 * The one refusal list for the opener edits (12.1-17, D-632, UI-D-651): an alert role, the 09.4 sheet-alert
 * geometry, a 14/700 title that says what cannot be done, a 12/400 hint that says what to do first, and a plain
 * `ul` of the dependents' titles (up to five, then "e mais N"). It renders inside the editor sheet, above the
 * footer buttons, for archive, delete, retype and option removal: a refusal that has a list is never a bare
 * toast. Titles are admin-typed, so they are React text with `break-words`, never HTML (T-12.1-12). It renders
 * nothing for an empty list: a refusal always names at least one dependent.
 */
export function DependentsAlert({ kind, dependents, label = '' }: DependentsAlertProps) {
  const t = useTranslations('profileForm.admin');
  if (dependents.length === 0) return null;
  const shown = dependents.slice(0, DEPENDENTS_SHOWN);
  const more = dependents.length - shown.length;
  return (
    <div
      role="alert"
      data-dependents-alert={kind}
      className="flex flex-col gap-2 rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger"
    >
      <span className="break-words text-sm font-bold">
        {t(`dependents.title.${kind}`, { label })}
      </span>
      <span className="text-xs font-normal text-text-secondary">
        {t(
          kind === 'option'
            ? 'dependents.hintOption'
            : kind === 'archiveBranch'
              ? 'dependents.hintArchiveBranch'
              : 'dependents.hint',
        )}
      </span>
      <ul
        aria-label={t('editor.opens.listLabel')}
        className="flex list-disc flex-col gap-1 pl-4 text-sm text-text"
      >
        {shown.map((dependent) => (
          <li key={dependent.id} className="break-words">
            {dependent.title}
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <span className="text-xs font-normal text-text-secondary">
          {t('dependents.more', { count: more })}
        </span>
      ) : null}
    </div>
  );
}
