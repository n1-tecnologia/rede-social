'use client';

import {
  type AdminBranch,
  type AdminQuestion,
  type AdminStep,
  PROFILE_FORM_LIMITS,
} from '@rede-social/contracts/profile-form';
import { Button, Card, IconButton, SectionTitle, StatusPill, useToast } from '@rede-social/ui';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  Eye,
  Info,
  Layers,
  Lock,
  Plus,
  Split,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react';
import { type LayoutStep, layoutOf, moveUnit } from '@/lib/profile-form/branch-layout';
import {
  type BranchRun,
  buildBranchTree,
  opensCountOf,
  type QuestionNode,
  type StepRoot,
  stepTree,
  usableBranch,
} from '@/lib/profile-form/branch-tree';
import { typeNameKey } from '@/lib/profile-form/question-types';
import { type ReorderLayoutResult, reorderLayoutAction, reorderQuestionsAction } from './actions';
import { BranchBlock, useBranchLabeler } from './BranchBlock';
import { StepWell } from './StepWell';

export interface QuestionListProps {
  /** The ACTIVE questions in the order members see them (the API's order). */
  questions: AdminQuestion[];
  /** The most active questions a tenant may have. */
  limit: number;
  /**
   * Opens the question in the editor. Plan 16 supplies it (the editor sheet); until then a row is a
   * button that takes no click handler of its own.
   */
  onOpen?: (question: AdminQuestion) => void;
  /** Opens the editor for a new question (12-16). Without it the list shows no "Adicionar pergunta". */
  onAdd?: () => void;
  /** Opens "Como o membro vê" (12-17). Without it the list shows no "Ver como o membro vê". */
  onPreview?: () => void;
  /**
   * The tenant's steps in order (12.1-16, D-627). With none the list is Phase 12's flat list and reorders
   * with the legacy body; with ONE it is the same flat list; with two or more it is a column of step wells.
   */
  steps?: AdminStep[];
  /** The most steps a tenant may have; "Adicionar etapa" is disabled at it (D-633). */
  stepLimit?: number;
  /** Opens the step sheet in create mode. Without it the list shows no "Adicionar etapa". */
  onAddStep?: () => void;
  /** Opens the step sheet in rename mode for a well. */
  onRenameStep?: (step: AdminStep) => void;
  /** Opens the editor in create mode with this step preselected (the well's footer). */
  onAddToStep?: (step: AdminStep) => void;
  /** The tenant's branches (12.2-15, D-640); absent reads as none. */
  branches?: AdminBranch[];
  /** Opens the branch sheet for a strip's pencil (plan 17 wires it). */
  onEditBranch?: (branch: AdminBranch) => void;
  /** Opens the question sheet in create mode inside a branch (plan 16 wires it). */
  onAddToBranch?: (branch: AdminBranch, stepId: string) => void;
}

const NO_STEPS: AdminStep[] = [];
const NO_BRANCHES: AdminBranch[] = [];

/**
 * The active questions cut into the steps' groups, each in order. A question of a step the list does not
 * know (it cannot happen: the API puts every question in a step) rides with the last step instead of
 * disappearing from the screen.
 */
function groupByStep(steps: AdminStep[], items: AdminQuestion[]): AdminQuestion[][] {
  if (steps.length === 0) return [items];
  const known = new Set(steps.map((step) => step.id));
  const last = steps[steps.length - 1];
  return steps.map((step) =>
    items.filter(
      (question) => question.stepId === step.id || (step === last && !known.has(question.stepId)),
    ),
  );
}

/** The list in the order members see it: the steps in order, each holding its questions. */
function normalize(steps: AdminStep[], items: AdminQuestion[]): AdminQuestion[] {
  return steps.length === 0 ? items : groupByStep(steps, items).flat();
}

type Direction = 'up' | 'down';

/**
 * D-623 over a candidate layout: the first question that would sit at or before the opener of its branch, as
 * the pair (the question in the branch, its opener), or `null`. The server enforces the same rule; this check
 * only lets the press say which two QUESTIONS conflict before anything moves.
 */
function orderViolation(
  layout: readonly LayoutStep[],
  questions: ReadonlyMap<string, AdminQuestion>,
  branchOpener: ReadonlyMap<string, string>,
): { dependent: AdminQuestion; opener: AdminQuestion } | null {
  const flat = layout.flatMap((step) => step.questionIds);
  const index = new Map(flat.map((id, at) => [id, at] as const));
  for (const [at, id] of flat.entries()) {
    const dependent = questions.get(id);
    const openerId = dependent?.branchId ? branchOpener.get(dependent.branchId) : undefined;
    if (dependent === undefined || openerId === undefined) continue;
    const openerAt = index.get(openerId);
    if (openerAt === undefined || openerAt < at) continue;
    const opener = questions.get(openerId);
    if (opener) return { dependent, opener };
  }
  return null;
}

/**
 * The body every row shares: position, title, badges and the meta line (UI-D-566, UI-D-667). A row carries at
 * most the pill "Abre N perguntas" when it opens branches: where a question lives is the branch block around
 * it, what a question controls is this pill, and both are words, never colour.
 */
function RowBody({
  question,
  position,
  opens,
}: {
  question: AdminQuestion;
  position: number;
  opens: number;
}) {
  const t = useTranslations('profileForm');
  const answered = question.answerCount > 0;
  return (
    <>
      <span aria-hidden className="w-5 shrink-0 pt-px text-xs font-bold text-text-tertiary">
        {position}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="line-clamp-3 break-words text-sm font-bold text-text">
          {question.title}
        </span>
        <span className="flex flex-wrap gap-2">
          <StatusPill tone="neutral">{t(typeNameKey(question.type))}</StatusPill>
          {opens > 0 ? (
            <StatusPill tone="neutral">
              <Split aria-hidden size={12} />
              {t('admin.row.opens', { count: opens })}
            </StatusPill>
          ) : null}
          {question.showOnProfile ? (
            <StatusPill tone="neutral">
              <Eye aria-hidden size={12} />
              {t('admin.row.onProfile')}
            </StatusPill>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-normal text-text-secondary">
          <span className={question.required ? 'font-bold text-text' : 'text-text-tertiary'}>
            {question.required ? t('admin.row.required') : t('admin.row.optional')}
          </span>
          <span aria-hidden>·</span>
          <span>{t('admin.row.answers', { count: question.answerCount })}</span>
          {answered ? (
            <>
              <Lock aria-hidden size={12} className="shrink-0" />
              <span className="sr-only">{t('admin.row.locked')}</span>
            </>
          ) : null}
        </span>
      </span>
    </>
  );
}

interface RowProps {
  question: AdminQuestion;
  /** The number across the WHOLE form, 1..total, in the order members see (UI-D-643). */
  position: number;
  total: number;
  /** The label of the branch the row sits in, for "Fica no ramo: {label}." (UI-D-667). */
  branchLabel: string | null;
  /** The ACTIVE questions in the branches that hang directly on this row: "Abre N". */
  opens: number;
  onOpen?: (question: AdminQuestion) => void;
  /** The branch blocks that hang on this row, drawn right under its card. */
  children?: ReactNode;
}

/**
 * One question of the builder (UI-D-566): the WHOLE row is one `button` (`min-h-11`) that opens the
 * editor. Colour and weight never carry a state alone: the required state, the position and the count
 * are words, and the position and the state are also in the accessible description. The branch blocks of an
 * opener live INSIDE its `li`, under the card (UI-D-666).
 */
function QuestionRow({
  question,
  position,
  total,
  branchLabel,
  opens,
  onOpen,
  children,
}: RowProps) {
  const t = useTranslations('profileForm');
  const descriptionId = useId();
  const answered = question.answerCount > 0;
  const stateWord = question.required ? t('admin.row.required') : t('admin.row.optional');
  const description = [
    t('admin.row.position', { position, total }),
    stateWord,
    t('admin.row.answers', { count: question.answerCount }),
    answered ? t('admin.row.locked') : null,
    branchLabel === null ? null : t('admin.branches.row.inBranch', { label: branchLabel }),
    opens > 0 ? t('admin.row.opens', { count: opens }) : null,
  ]
    .filter((part): part is string => part !== null)
    .map((part) => (part.endsWith('.') ? part : `${part}.`))
    .join(' ');

  return (
    <li className={children ? 'flex flex-col gap-3' : undefined}>
      <Card className="p-0">
        <button
          type="button"
          aria-label={t('admin.row.edit', { title: question.title })}
          aria-describedby={descriptionId}
          onClick={onOpen ? () => onOpen(question) : undefined}
          className="flex min-h-11 w-full items-start gap-3 p-4 text-left transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
        >
          <RowBody question={question} position={position} opens={opens} />
          <ChevronRight aria-hidden size={18} className="mt-[2px] shrink-0 text-text-tertiary" />
        </button>
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      </Card>
      {children}
    </li>
  );
}

interface ReorderRowProps {
  question: AdminQuestion;
  /** The number across the whole form. */
  position: number;
  /** The row's place among its siblings (the questions of its branch run, or the unconditional ones of its step). */
  groupIndex: number;
  groupSize: number;
  opens: number;
  busy: boolean;
  register: (key: string, element: HTMLButtonElement | null) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  /** The branch blocks that hang on this row: its block travels with it. */
  children?: ReactNode;
}

/**
 * A row in reorder mode (UI-D-567, UI-D-646, UI-D-668): not an editor opener (no accidental taps). The chevron is
 * replaced by two 44x44 `IconButton`s, disabled on the first and the last SIBLING (a group of one has both
 * disabled): an arrow moves a question one place among its siblings and never to another step or branch, and
 * an opener's whole block counts as one place. While a write runs the buttons are `aria-busy` and ignore
 * presses instead of becoming `disabled`, so the focused control keeps focus through the write.
 */
function ReorderRow({
  question,
  position,
  groupIndex,
  groupSize,
  opens,
  busy,
  register,
  onMove,
  children,
}: ReorderRowProps) {
  const t = useTranslations('profileForm.admin.reorder');
  return (
    <li className={children ? 'flex flex-col gap-3' : undefined}>
      <Card className="p-0">
        <div className="flex min-h-11 w-full items-start gap-3 p-4">
          <RowBody question={question} position={position} opens={opens} />
          <span className="-my-2 -mr-2 flex shrink-0 items-center">
            <IconButton
              ref={(element) => register(`${question.id}:up`, element)}
              icon={ArrowUp}
              size={18}
              label={t('up', { title: question.title })}
              disabled={groupIndex === 0}
              aria-busy={busy || undefined}
              onClick={() => onMove(question.id, -1)}
            />
            <IconButton
              ref={(element) => register(`${question.id}:down`, element)}
              icon={ArrowDown}
              size={18}
              label={t('down', { title: question.title })}
              disabled={groupIndex === groupSize - 1}
              aria-busy={busy || undefined}
              onClick={() => onMove(question.id, 1)}
            />
          </span>
        </div>
      </Card>
      {children}
    </li>
  );
}

/** The step every question rides in when the list has no step at all: one flat group. */
const FLAT_STEP: AdminStep = { id: 'flat', title: '', position: 1, revision: 1, questionCount: 0 };

/**
 * The active list of the Perguntas tab (12-15, 12.1-16, 12.2-15; D-582, D-623, D-627, D-640..D-643, D-652,
 * UI-D-565..UI-D-567, UI-D-642..UI-D-646, UI-D-666..UI-D-668): the actions row ("Adicionar pergunta",
 * "Adicionar etapa", "Reordenar", "Ver como o membro vê"), the limit lines, the "Perguntas ativas (n)" micro-title
 * and the rows in the admin's order, which is the order members see. **With one step (or none) the rows are the
 * flat list of Phase 12; with two or more they sit in step wells** under a one-time note, numbered across the
 * whole form. **A branch is a block** inside the well, indented under its opener (`BranchBlock`): the tree is
 * built once from the read (`buildBranchTree`) and each well draws its `stepTree`.
 *
 * **Reorder is a mode with buttons, never a drag** (a drag fights the scroll of a mobile page, and the
 * buttons are the keyboard alternative). Each press moves the row (or, on a well's header, the whole step),
 * SAVES AT ONCE with one write of the WHOLE layout through the server action, keeps focus on the same
 * button at its new position (re-applied after React moves the row, because a moved node loses focus; if
 * that button is now disabled at an edge, its sibling takes the focus) and announces the new position
 * through an `aria-live="polite"` region. **An arrow moves a question one place among its siblings, inside its
 * step and branch, and an opener's block travels with it.** A press that would put a question at or before the
 * opener of its branch (or a step above the step that holds an opener of one of its questions) moves NOTHING
 * and toasts which two QUESTIONS conflict; the server's coded 409 for the same rule, after a race, puts the
 * list back and says the same sentence. A failed write puts the row back and toasts; a lost permission or a
 * module turned off ends in a refresh into the page's `notFound()`.
 *
 * The tab is read once per request on the server: the list holds the server's copy and the optimistic
 * order only while a write is in flight, and the page refreshes when the mode ends. It shows aggregate
 * counts only (PFORM-23): never an individual member's answer, and it makes no request of its own.
 */
export function QuestionList({
  questions,
  limit,
  onOpen,
  onAdd,
  onPreview,
  steps = NO_STEPS,
  stepLimit = PROFILE_FORM_LIMITS.steps,
  onAddStep,
  onRenameStep,
  onAddToStep,
  branches = NO_BRANCHES,
  onEditBranch,
  onAddToBranch,
}: QuestionListProps) {
  const t = useTranslations('profileForm');
  const tAdmin = useTranslations('admin');
  const router = useRouter();
  const toast = useToast();

  // The server's list wins whenever it re-renders with a new one (after a refresh).
  const [source, setSource] = useState({ questions, steps, branches });
  const [items, setItems] = useState(() => normalize(steps, questions));
  const [stepList, setStepList] = useState(steps);
  if (source.questions !== questions || source.steps !== steps || source.branches !== branches) {
    setSource({ questions, steps, branches });
    setItems(normalize(steps, questions));
    setStepList(steps);
  }

  const [reordering, setReordering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const controls = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<{ id: string; direction: Direction } | null>(null);

  function register(key: string, element: HTMLButtonElement | null) {
    if (element) controls.current.set(key, element);
    else controls.current.delete(key);
  }

  // After the rows have moved, put focus back on the control the admin pressed (its row's key), or on
  // the sibling when that control is now disabled at an edge. Runs only when a move asked for it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `items` is the trigger, focus is read through the refs
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const other: Direction = target.direction === 'up' ? 'down' : 'up';
    const first = controls.current.get(`${target.id}:${target.direction}`);
    const second = controls.current.get(`${target.id}:${other}`);
    const winner = first && !first.disabled ? first : second && !second.disabled ? second : null;
    winner?.focus();
  }, [items]);

  // The one tree the whole screen is drawn from. A list with no step rides in one flat group, and a question of
  // a step the list does not know rides with the last step (as before), so none disappears from the screen.
  const treeSteps = stepList.length === 0 ? [FLAT_STEP] : stepList;
  const lastStep = treeSteps[treeSteps.length - 1] ?? FLAT_STEP;
  const knownSteps = new Set(treeSteps.map((step) => step.id));
  const tree = buildBranchTree({
    steps: treeSteps,
    questions: items.map((question) =>
      knownSteps.has(question.stepId) ? question : { ...question, stepId: lastStep.id },
    ),
    branches,
  });
  const byId = new Map(items.map((question) => [question.id, question] as const));
  const original = (question: AdminQuestion) => byId.get(question.id) ?? question;
  const labelOf = useBranchLabeler(tree);
  const layout = layoutOf(tree);
  const branchOpener = new Map(
    tree.branches
      .filter((branch) => branch.archivedAt === null)
      .map((branch) => [branch.id, branch.openerQuestionId] as const),
  );
  const wells = stepList.length > 1;

  /** The sentence of a refused or reverted press, naming the two QUESTIONS (D-623, UI-D-646). */
  function refusalSentence(delta: -1 | 1, dependent: AdminQuestion, opener: AdminQuestion) {
    return delta < 0
      ? t('admin.reorder.mustFollow', { title: dependent.title, other: opener.title })
      : t('admin.reorder.mustPrecede', { title: opener.title, other: dependent.title });
  }

  /**
   * One press: checks D-623 on the layout the list already holds, then saves the WHOLE layout at once. A
   * press the server would refuse changes nothing and says why; a failed write puts the list back.
   */
  async function apply(change: {
    nextSteps: AdminStep[];
    nextLayout: LayoutStep[];
    focusId: string;
    delta: -1 | 1;
    announce: (flat: AdminQuestion[]) => string;
  }) {
    const { nextSteps, nextLayout, focusId, delta, announce } = change;
    const nextItems = nextLayout
      .flatMap((step) => step.questionIds)
      .map((id) => byId.get(id))
      .filter((question): question is AdminQuestion => question !== undefined);
    const direction: Direction = delta < 0 ? 'up' : 'down';

    const violation = orderViolation(nextLayout, tree.questionById, branchOpener);
    if (violation) {
      toast.show({
        tone: 'error',
        message: refusalSentence(delta, violation.dependent, violation.opener),
      });
      return;
    }

    const previous = { items, steps: stepList };
    pendingFocus.current = { id: focusId, direction };
    setItems(nextItems);
    setStepList(nextSteps);
    setBusy(true);

    let result: ReorderLayoutResult;
    try {
      result =
        nextSteps.length > 0
          ? await reorderLayoutAction({
              steps: nextLayout.map((step) => ({
                id: step.stepId,
                questionIds: step.questionIds,
              })),
            })
          : await reorderQuestionsAction(nextItems.map((question) => question.id));
    } catch {
      result = { ok: false, code: 'failed' };
    }
    setBusy(false);

    if (result.ok) {
      setAnnouncement(announce(nextItems));
      return;
    }

    // The list goes back where it was and the pressed control keeps focus.
    pendingFocus.current = { id: focusId, direction };
    setItems(previous.items);
    setStepList(previous.steps);
    if (result.code === 'moduleOff') {
      toast.show({ tone: 'error', message: t('admin.errors.moduleOff') });
      router.refresh();
    } else if (result.code === 'forbidden') {
      toast.show({ tone: 'error', message: tAdmin('errors.forbidden') });
      router.refresh();
    } else if (result.code === 'condition_order') {
      // A race the check above could not see: the same sentence, naming the same two questions.
      const dependent = previous.items.find((question) => question.id === result.questionId);
      const opener = previous.items.find((question) => question.id === result.openerId);
      toast.show({
        tone: 'error',
        message:
          dependent && opener
            ? refusalSentence(delta, dependent, opener)
            : t('admin.reorder.failed'),
      });
      router.refresh();
    } else {
      toast.show({ tone: 'error', message: t('admin.reorder.failed') });
      if (result.code === 'mismatch') router.refresh();
    }
  }

  function moveQuestion(id: string, delta: -1 | 1) {
    if (busy) return;
    const nextLayout = moveUnit(layout, tree, id, delta < 0 ? 'up' : 'down');
    // A press at the first or last sibling changes nothing and sends nothing.
    if (nextLayout === layout) return;
    const moved = byId.get(id);
    if (!moved) return;
    void apply({
      nextSteps: stepList,
      nextLayout,
      focusId: id,
      delta,
      announce: (flat) =>
        t('admin.reorder.moved', {
          title: moved.title,
          position: flat.findIndex((question) => question.id === id) + 1,
          total: flat.length,
        }),
    });
  }

  function moveStep(id: string, delta: -1 | 1) {
    if (busy) return;
    const from = stepList.findIndex((step) => step.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= stepList.length) return;

    const nextSteps = stepList.slice();
    const [moved] = nextSteps.splice(from, 1);
    if (!moved) return;
    nextSteps.splice(to, 0, moved);
    const nextLayout = layout.slice();
    const [movedRows] = nextLayout.splice(from, 1);
    if (movedRows) nextLayout.splice(to, 0, movedRows);
    void apply({
      nextSteps,
      nextLayout,
      focusId: `step:${id}`,
      delta,
      announce: () =>
        t('admin.steps.reorder.moved', {
          title: moved.title,
          position: to + 1,
          total: nextSteps.length,
        }),
    });
  }

  function toggleReordering() {
    if (busy) return;
    const leaving = reordering;
    setReordering(!reordering);
    // Every write refreshes: leaving the mode re-reads the list the server now holds.
    if (leaving) router.refresh();
  }

  /** The step "Adicionar pergunta ao ramo" hands to the sheet: the run's step, or the last step when the branch is empty. */
  function stepForAdd(run: BranchRun): string {
    if (run.empty) {
      const opener = byId.get(run.branch.openerQuestionId);
      return stepList.length > 0 ? lastStep.id : (opener?.stepId ?? lastStep.id);
    }
    const last = run.questions[run.questions.length - 1];
    return stepList.length > 0 ? run.stepId : last ? original(last.question).stepId : run.stepId;
  }

  function renderRun(run: BranchRun): ReactNode {
    const parts = labelOf(run.branch);
    const openerStepId = tree.questionById.get(run.branch.openerQuestionId)?.stepId;
    const openerStepTitle = run.openerInOtherStep
      ? (stepList.find((step) => step.id === openerStepId)?.title ?? null)
      : null;
    return (
      <BranchBlock
        key={`${run.branch.id}:${run.stepId}`}
        branch={run.branch}
        parts={parts}
        count={run.questions.length}
        empty={run.empty}
        openerStepTitle={openerStepTitle}
        reordering={reordering}
        busy={busy}
        place={null}
        addDisabled={items.length >= limit}
        focusKey={`branch:${run.branch.id}:${run.stepId}`}
        register={register}
        onMove={() => {}}
        onEdit={onEditBranch}
        onAddQuestion={onAddToBranch ? () => onAddToBranch(run.branch, stepForAdd(run)) : undefined}
      >
        {run.empty
          ? null
          : run.questions.map((child, at) => renderQuestion(child, at, run.questions.length))}
      </BranchBlock>
    );
  }

  function renderQuestion(node: QuestionNode, groupIndex: number, groupSize: number): ReactNode {
    const question = original(node.question);
    const opens = opensCountOf(tree, question.id);
    const inBranch = usableBranch(tree, question.branchId);
    const blocks = node.branches.map(renderRun);
    const nested = blocks.length > 0 ? blocks : undefined;
    return reordering ? (
      <ReorderRow
        key={question.id}
        question={question}
        position={node.number}
        groupIndex={groupIndex}
        groupSize={groupSize}
        opens={opens}
        busy={busy}
        register={register}
        onMove={moveQuestion}
      >
        {nested}
      </ReorderRow>
    ) : (
      <QuestionRow
        key={question.id}
        question={question}
        position={node.number}
        total={items.length}
        branchLabel={inBranch ? labelOf(inBranch).label : null}
        opens={opens}
        onOpen={onOpen}
      >
        {nested}
      </QuestionRow>
    );
  }

  function renderRoots(roots: StepRoot[]): ReactNode {
    const rootQuestions = roots.filter((root) => root.kind === 'question');
    let questionAt = 0;
    return (
      <ul className="flex flex-col gap-3">
        {roots.map((root) => {
          if (root.kind === 'run') {
            return <li key={`${root.run.branch.id}:${root.run.stepId}`}>{renderRun(root.run)}</li>;
          }
          const at = questionAt;
          questionAt += 1;
          return renderQuestion(root.node, at, rootQuestions.length);
        })}
      </ul>
    );
  }

  const renderStep = (stepId: string): ReactNode => {
    const node = stepTree(tree, stepId);
    return node === null || node.roots.length === 0 ? null : renderRoots(node.roots);
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {onAdd ? (
          <Button size="md" disabled={items.length >= limit} onClick={onAdd}>
            <Plus aria-hidden size={18} />
            {t('admin.actions.add')}
          </Button>
        ) : null}
        {onAddStep ? (
          <Button
            variant="outline"
            size="md"
            disabled={stepList.length >= stepLimit}
            onClick={onAddStep}
          >
            <Layers aria-hidden size={18} />
            {t('admin.steps.add')}
          </Button>
        ) : null}
        <Button variant="outline" size="md" aria-pressed={reordering} onClick={toggleReordering}>
          <ArrowUpDown aria-hidden size={18} />
          {reordering ? t('admin.actions.reorderDone') : t('admin.actions.reorder')}
        </Button>
        {onPreview ? (
          <Button variant="ghost" size="md" disabled={items.length === 0} onClick={onPreview}>
            {t('admin.preview.open')}
          </Button>
        ) : null}
      </div>
      {onAddStep && stepList.length >= stepLimit ? (
        <p data-step-limit-line className="text-xs font-normal text-text-tertiary">
          {t('admin.steps.limit', { max: stepLimit })}
        </p>
      ) : null}
      {items.length >= limit ? (
        <p data-limit-line className="text-xs font-normal text-text-tertiary">
          {t('admin.list.limit', { max: limit })}
        </p>
      ) : null}
      <SectionTitle variant="micro">{t('admin.list.title', { count: items.length })}</SectionTitle>
      {wells ? (
        <div
          role="status"
          data-steps-note
          className="flex items-start gap-2 rounded-xl bg-bg-tertiary px-3 py-3 text-xs font-normal text-text"
        >
          <Info aria-hidden size={16} className="mt-px shrink-0 text-text-secondary" />
          <span className="min-w-0 flex-1 break-words">{t('admin.steps.note')}</span>
        </div>
      ) : null}
      <p aria-live="polite" aria-atomic="true" data-reorder-live className="sr-only">
        {announcement}
      </p>
      {wells ? (
        <div className="flex flex-col gap-3">
          {stepList.map((step, at) => (
            <StepWell
              key={step.id}
              step={step}
              number={at + 1}
              total={stepList.length}
              count={layout[at]?.questionIds.length ?? 0}
              reordering={reordering}
              busy={busy}
              addDisabled={items.length >= limit}
              onRename={(target) => onRenameStep?.(target)}
              onAddQuestion={(target) => onAddToStep?.(target)}
              onMove={moveStep}
              register={register}
            >
              {renderStep(step.id)}
            </StepWell>
          ))}
        </div>
      ) : (
        renderStep(treeSteps[0]?.id ?? FLAT_STEP.id)
      )}
    </section>
  );
}
