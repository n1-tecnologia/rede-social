'use client';

import type { AdminBranch, AdminQuestion, AdminStep } from '@rede-social/contracts/profile-form';
import { StatusPill } from '@rede-social/ui';
import { ChevronRight, CornerDownRight, Info, Layers } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import {
  type AdminBranchTree,
  type FlowBranch,
  type FlowQuestion,
  flowTree,
} from '@/lib/profile-form/branch-tree';
import { capAnswers, formatDisjunction } from '@/lib/profile-form/describe-branch';
import { typeNameKey } from '@/lib/profile-form/question-types';
import { useBranchLabeler } from './BranchBlock';

/** The most answers an edge names before "e mais {count}" (UI-D-676); the full set is in the branch sheet. */
const ANSWER_CAP = 4;

export interface FlowViewProps {
  /** The one tree the Lista is drawn from (`buildBranchTree`). */
  tree: AdminBranchTree;
  /** The builder's steps: the "Etapa {n}" pill shows from two. */
  steps: readonly AdminStep[];
  /** A question node was tapped: the question and the element that was tapped (focus goes back there). */
  onOpenQuestion: (question: AdminQuestion, trigger: HTMLElement) => void;
  /** A branch edge was tapped: the branch and the element that was tapped. */
  onOpenBranch: (branch: AdminBranch, trigger: HTMLElement) => void;
}

/** Focus ring and hover of every tappable piece of the drawing, the same as the Lista's rows. */
const TAPPABLE =
  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand';

interface NodeProps {
  question: FlowQuestion;
  /** True with two or more steps: the neutral pill "Etapa {n}" joins the second line. */
  withStep: boolean;
  onOpen: (trigger: HTMLElement) => void;
}

/**
 * A question of the drawing (UI-D-676): ONE native `button` of 44px in the shipped row chrome, with no number.
 * Line 1 is the title (two lines at most) and the chevron; line 2 says the type, whether it is required and,
 * when public, "No perfil", plus the step pill from two steps. The accessible name is "Editar pergunta: {title}"
 * and the second line is its description, so colour and position never carry the meaning.
 */
export function FlowNode({ question, withStep, onOpen }: NodeProps) {
  const t = useTranslations('profileForm');
  const detailsId = useId();
  return (
    <button
      type="button"
      aria-label={t('admin.row.edit', { title: question.title })}
      aria-describedby={detailsId}
      onClick={(event) => onOpen(event.currentTarget)}
      className={`flex min-h-11 w-full flex-col rounded-xl bg-bg-secondary px-3 py-2 text-left shadow-[0_1px_3px_rgba(22,35,59,.06)] hover:bg-bg-hover dark:border dark:border-border ${TAPPABLE}`}
    >
      <span className="flex items-start gap-2">
        <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-bold text-text">
          {question.title}
        </span>
        <ChevronRight aria-hidden size={16} className="mt-1 shrink-0 text-text-tertiary" />
      </span>
      <span
        id={detailsId}
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-normal text-text-secondary"
      >
        <span>{t(typeNameKey(question.type))}</span>
        <span aria-hidden>·</span>
        <span>{question.required ? t('admin.row.required') : t('admin.row.optional')}</span>
        {question.showOnProfile ? (
          <>
            <span aria-hidden>·</span>
            <span>{t('admin.row.onProfile')}</span>
          </>
        ) : null}
        {withStep && question.stepOrdinal > 0 ? (
          <StatusPill tone="neutral">
            <Layers aria-hidden size={12} />
            {t('admin.steps.eyebrow', { n: question.stepOrdinal })}
          </StatusPill>
        ) : null}
      </span>
    </button>
  );
}

interface EdgeProps {
  branch: FlowBranch;
  onOpen: (trigger: HTMLElement) => void;
}

/**
 * The connection between an opener and the questions of one of its branches (UI-D-676): ONE native `button`.
 * Line 1 is the admin's name when the branch has one; the next line says which answers open it and how many
 * questions it holds, wrapping in full. The answers are the opener's own option labels, at most four and then
 * "e mais {count}"; a yes/no opener says the plain words Sim or Não. The button's name is its text, so the
 * meaning does not depend on the rail or the indentation.
 */
export function FlowEdge({ branch, onOpen }: EdgeProps) {
  const t = useTranslations('profileForm');
  const words = { true: t('member.controls.yes'), false: t('member.controls.no') };
  const label = branch.label;
  let options = '';
  if (label !== null) {
    if (label.yesNo) {
      options = new Intl.ListFormat('pt-BR', { type: 'disjunction' }).format(
        label.values.map((value) => words[value]),
      );
    } else if (label.labels.length > 0) {
      const { shown, more } = capAnswers(label.labels, ANSWER_CAP);
      options =
        more === 0
          ? formatDisjunction(shown)
          : `${shown.map((answer) => `“${answer}”`).join(', ')} ${t('admin.flow.moreOptions', { count: more })}`;
    }
  }
  const name = label?.name;
  return (
    <button
      type="button"
      onClick={(event) => onOpen(event.currentTarget)}
      className={`flex min-h-11 w-full items-start gap-2 rounded-xl bg-bg-tertiary px-3 py-2 text-left hover:bg-bg-hover ${TAPPABLE}`}
    >
      <CornerDownRight aria-hidden size={14} className="mt-1 shrink-0 text-text-tertiary" />
      <span className="flex min-w-0 flex-1 flex-col">
        {name !== undefined ? (
          <>
            <span className="break-words text-xs font-bold text-text">{name}</span>{' '}
          </>
        ) : null}
        <span className="break-words text-xs font-normal text-text-secondary">
          {options === ''
            ? t('admin.branches.count', { count: branch.questionCount })
            : t('admin.flow.edge', { options, count: branch.questionCount })}
        </span>
      </span>
    </button>
  );
}

/** A question with the branches that hang on it, one rail per branch (the Lista's rail, 18px per level). */
function FlowItem({
  question,
  withStep,
  tree,
  onOpenQuestion,
  onOpenBranch,
  labelOf,
}: {
  question: FlowQuestion;
  withStep: boolean;
  tree: AdminBranchTree;
  onOpenQuestion: FlowViewProps['onOpenQuestion'];
  onOpenBranch: FlowViewProps['onOpenBranch'];
  labelOf: (branchId: string) => string;
}) {
  const t = useTranslations('profileForm.admin.flow');
  return (
    <li className="flex min-w-0 flex-col gap-2">
      <FlowNode
        question={question}
        withStep={withStep}
        onOpen={(trigger) => {
          const found = tree.questionById.get(question.id);
          if (found !== undefined) onOpenQuestion(found, trigger);
        }}
      />
      {question.branches.map((branch) => (
        <div
          key={branch.id}
          className="ml-1 flex min-w-0 flex-col gap-2 border-l-2 border-border-secondary pl-3"
        >
          <FlowEdge
            branch={branch}
            onOpen={(trigger) => {
              const found = tree.branchById.get(branch.id);
              if (found !== undefined) onOpenBranch(found, trigger);
            }}
          />
          {branch.questions.length > 0 ? (
            <ul
              aria-label={t('childrenLabel', { label: labelOf(branch.id) })}
              className="flex flex-col gap-2"
            >
              {branch.questions.map((child) => (
                <FlowItem
                  key={child.id}
                  question={child}
                  withStep={withStep}
                  tree={tree}
                  onOpenQuestion={onOpenQuestion}
                  onOpenBranch={onOpenBranch}
                  labelOf={labelOf}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </li>
  );
}

/**
 * The Fluxo (12.2-19, D-647, D-648, D-649; UI-D-676, UI-D-677, UI-D-682): the form drawn as a READ-ONLY vertical
 * tree by branch, on the page ground. It answers "who sees this question?": the root list is what every member
 * sees, an edge says which answers open a branch, and its questions hang under it, to three levels. Steps are
 * not headings (a branch's questions may sit in different steps): the pill on a node is the only step cue.
 *
 * It draws what the page already read and makes no request: a tap on a node or an edge hands the question or
 * the branch to the host, which opens the editor already built. Nothing is dragged, wired or created here, and
 * there is no collapse, zoom or pan. It is a `section` named by an sr-only heading with nested lists and NO
 * ARIA tree role (no arrow-key model is promised); each node and edge is a native `button` reached by Tab in
 * reading order, and each child list is named by the label of its branch. Every text is React text
 * (T-12.2-15); the branch name is admin-only and exists only in this builder screen.
 */
export function FlowView({ tree, steps, onOpenQuestion, onOpenBranch }: FlowViewProps) {
  const t = useTranslations('profileForm.admin.flow');
  const headingId = useId();
  const labelOf = useBranchLabeler(tree);
  const { roots } = flowTree(tree);
  const labels = (branchId: string): string => {
    const branch = tree.branchById.get(branchId);
    return branch === undefined ? '' : labelOf(branch).label;
  };

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <h3 id={headingId} className="sr-only">
        {t('label')}
      </h3>
      <div className="flex items-start gap-2 rounded-xl bg-bg-tertiary px-3 py-3 text-xs font-normal text-text">
        <Info aria-hidden size={16} className="mt-px shrink-0 text-text-secondary" />
        <span className="min-w-0 flex-1 break-words">{t('note')}</span>
      </div>
      <span className="text-xs font-bold text-text-tertiary">{t('root')}</span>
      <ul className="flex flex-col gap-2">
        {roots.map((question) => (
          <FlowItem
            key={question.id}
            question={question}
            withStep={steps.length >= 2}
            tree={tree}
            onOpenQuestion={onOpenQuestion}
            onOpenBranch={onOpenBranch}
            labelOf={labels}
          />
        ))}
      </ul>
    </section>
  );
}
