'use client';

import type { AdminBranch } from '@rede-social/contracts/profile-form';
import { Button, IconButton } from '@rede-social/ui';
import { Layers, Pencil, Plus, Split } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId } from 'react';
import type { AdminBranchTree } from '@/lib/profile-form/branch-tree';
import { describeBranch } from '@/lib/profile-form/describe-branch';
import { formatDisjunction } from '@/lib/profile-form/describe-condition';

/**
 * A branch in the builder's Lista (12.2-15, D-640, D-641, D-642, D-643; UI-D-666, UI-D-682, UI-D-684): a block
 * indented under its opener. A `div` rail (a 2px left rule in the secondary border token, 18px per level)
 * holds (1) the strip, (2) the `ul` of the branch's question rows named by the strip, and (3) a footer. An
 * empty branch shows its own line instead of rows. The rows are drawn by the list and handed in as
 * `children`, so a nested branch is simply another block inside one of those rows.
 *
 * Everything the admin typed (the branch name, the question titles) is React text, wrapped and clamped to
 * two lines (T-12.2-15). The name exists only here, in the admin builder (T-12.2-03): no member or staff
 * component imports this file. Colour never carries meaning: the strip is words and an icon.
 */

/** The label of a branch as the strip and the row descriptions read it. */
export interface BranchLabelParts {
  /** The name when the branch has one, else the sentence. */
  label: string;
  /** "Se “{opener}” for {options}", no final period. */
  sentence: string;
  /** The admin's name, or `null`. */
  name: string | null;
}

/**
 * The label of every branch of the builder, built from `describeBranch` and the catalog: no component types a
 * label. The answers are the opener's own option labels, joined with the pt-BR disjunction and quoted; for a
 * yes/no opener they are the plain words Sim and Não, unquoted. A branch whose opener the tree does not hold
 * has an empty sentence, and one that names no option its opener still has falls back to the opener's title
 * rather than print half a sentence.
 */
export function useBranchLabeler(tree: AdminBranchTree): (branch: AdminBranch) => BranchLabelParts {
  const t = useTranslations('profileForm');
  const words = { true: t('member.controls.yes'), false: t('member.controls.no') };
  return (branch) => {
    const description = describeBranch(branch, tree.questionById);
    if (description === null) {
      const name = branch.name?.trim() ?? '';
      return { label: name, sentence: '', name: name === '' ? null : name };
    }
    const options = description.yesNo
      ? new Intl.ListFormat('pt-BR', { type: 'disjunction' }).format(
          description.values.map((value) => words[value]),
        )
      : description.labels.length === 0
        ? ''
        : formatDisjunction(description.labels);
    const sentence =
      options === ''
        ? description.openerTitle
        : t('admin.branches.label', { opener: description.openerTitle, options });
    const name = description.name ?? null;
    return { label: name ?? sentence, sentence, name };
  };
}

export interface BranchBlockProps {
  branch: AdminBranch;
  parts: BranchLabelParts;
  /** How many questions this block draws (a branch that sits in several steps has a block per step). */
  count: number;
  /** True when the branch holds no active question at all: the empty line stands in for the rows. */
  empty: boolean;
  /** The title of the step that holds the opener, when it is NOT this block's step. */
  openerStepTitle: string | null;
  /** In reorder mode the pencil is replaced by the branch arrows (plan 15, task 3). */
  reordering: boolean;
  /** A write is in flight: the arrows ignore presses and stay focusable. */
  busy: boolean;
  /** This block's place among the blocks of its opener in this step; the arrows show for two or more. */
  place: { index: number; size: number } | null;
  /** The 30-question ceiling: the footer is disabled. */
  addDisabled: boolean;
  /** The prefix of the arrows' focus keys. */
  focusKey: string;
  register: (key: string, element: HTMLButtonElement | null) => void;
  onMove: (delta: -1 | 1) => void;
  /** Opens the branch sheet; without it the strip has no pencil. */
  onEdit?: (branch: AdminBranch) => void;
  /** Adds a question to the branch; without it the block has no footer. */
  onAddQuestion?: () => void;
  /** The `li` rows of the branch (not drawn when the branch is empty). */
  children?: ReactNode;
}

export function BranchBlock({
  branch,
  parts,
  count,
  empty,
  openerStepTitle,
  reordering,
  onEdit,
  onAddQuestion,
  addDisabled,
  children,
}: BranchBlockProps) {
  const t = useTranslations('profileForm.admin.branches');
  const labelId = useId();

  return (
    <div className="flex flex-col gap-3 ml-1 border-l-2 border-border-secondary pl-3">
      <div data-branch-strip className="flex items-start gap-2">
        <Split aria-hidden size={14} className="mt-px shrink-0 text-text-tertiary" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span
            id={labelId}
            className="line-clamp-2 break-words text-xs font-bold text-text-secondary"
          >
            {parts.label}
          </span>
          {parts.name !== null ? (
            <span className="line-clamp-2 break-words text-xs font-normal text-text-tertiary">
              {parts.sentence}
            </span>
          ) : null}
          <span className="text-xs font-normal text-text-tertiary">{t('count', { count })}</span>
          {openerStepTitle !== null ? (
            <span className="break-words text-xs font-normal text-text-tertiary">
              {t('openerStep', { step: openerStepTitle })}
            </span>
          ) : null}
        </div>
        {!reordering && onEdit ? (
          <div className="-mr-2 -mt-2 flex shrink-0">
            <IconButton
              icon={Pencil}
              size={18}
              label={t('edit', { label: parts.label })}
              onClick={() => onEdit(branch)}
            />
          </div>
        ) : null}
      </div>

      {empty ? (
        <p
          data-branch-empty
          className="flex items-start gap-2 text-xs font-normal text-text-tertiary"
        >
          <Layers aria-hidden size={16} className="mt-px shrink-0" />
          <span className="min-w-0 flex-1">{t('empty')}</span>
        </p>
      ) : (
        <ul aria-labelledby={labelId} className="flex flex-col gap-3">
          {children}
        </ul>
      )}

      {onAddQuestion ? (
        <div className="flex">
          <Button
            variant="ghost"
            size="sm"
            hitArea
            disabled={addDisabled}
            aria-label={t('addQuestionLabel', { label: parts.label })}
            onClick={onAddQuestion}
          >
            <Plus aria-hidden size={16} />
            {t('addQuestion')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
