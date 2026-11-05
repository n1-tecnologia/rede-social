'use client';

import {
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
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { typeNameKey } from '@/lib/profile-form/question-types';
import { type ReorderLayoutResult, reorderLayoutAction, reorderQuestionsAction } from './actions';
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
}

const NO_STEPS: AdminStep[] = [];

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

/**
 * D-623 over a candidate order: the first question that would sit at or before the opener of its condition,
 * as the pair (the conditional question, its opener), or `null`. The server enforces the same rule; this
 * check only lets the press say which two QUESTIONS conflict before anything moves.
 */
function orderViolation(
  flat: AdminQuestion[],
): { dependent: AdminQuestion; opener: AdminQuestion } | null {
  const index = new Map(flat.map((question, at) => [question.id, at] as const));
  for (const [at, question] of flat.entries()) {
    if (question.condition === null) continue;
    const openerAt = index.get(question.condition.questionId);
    if (openerAt === undefined || openerAt < at) continue;
    const opener = flat[openerAt];
    if (opener) return { dependent: question, opener };
  }
  return null;
}

type Direction = 'up' | 'down';

/** The body every row shares: position, title, badges and the meta line (UI-D-566). */
function RowBody({ question, position }: { question: AdminQuestion; position: number }) {
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
  onOpen?: (question: AdminQuestion) => void;
}

/**
 * One question of the builder (UI-D-566): the WHOLE row is one `button` (`min-h-11`) that opens the
 * editor. Colour and weight never carry a state alone: the required state, the position and the count
 * are words, and the position and the state are also in the accessible description.
 */
function QuestionRow({ question, position, total, onOpen }: RowProps) {
  const t = useTranslations('profileForm');
  const descriptionId = useId();
  const answered = question.answerCount > 0;
  const stateWord = question.required ? t('admin.row.required') : t('admin.row.optional');
  const description = [
    t('admin.row.position', { position, total }),
    stateWord,
    t('admin.row.answers', { count: question.answerCount }),
    answered ? t('admin.row.locked') : null,
  ]
    .filter((part): part is string => part !== null)
    .map((part) => `${part}.`)
    .join(' ');

  return (
    <li>
      <Card className="p-0">
        <button
          type="button"
          aria-label={t('admin.row.edit', { title: question.title })}
          aria-describedby={descriptionId}
          onClick={onOpen ? () => onOpen(question) : undefined}
          className="flex min-h-11 w-full items-start gap-3 p-4 text-left transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
        >
          <RowBody question={question} position={position} />
          <ChevronRight aria-hidden size={18} className="mt-0.5 shrink-0 text-text-tertiary" />
        </button>
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      </Card>
    </li>
  );
}

interface ReorderRowProps {
  question: AdminQuestion;
  /** The number across the whole form. */
  position: number;
  /** The row's place inside its step (or inside the flat list) and how many rows that group holds. */
  groupIndex: number;
  groupSize: number;
  busy: boolean;
  register: (key: string, element: HTMLButtonElement | null) => void;
  onMove: (id: string, delta: -1 | 1) => void;
}

/**
 * A row in reorder mode (UI-D-567, UI-D-646): not an editor opener (no accidental taps). The chevron is
 * replaced by two 44x44 `IconButton`s, disabled on the first and the last row OF ITS STEP (a group of one
 * has both disabled): an arrow never moves a question to another step. While a write runs the buttons are
 * `aria-busy` and ignore presses instead of becoming `disabled`, so the focused control keeps focus through
 * the write.
 */
function ReorderRow({
  question,
  position,
  groupIndex,
  groupSize,
  busy,
  register,
  onMove,
}: ReorderRowProps) {
  const t = useTranslations('profileForm.admin.reorder');
  return (
    <li>
      <Card className="p-0">
        <div className="flex min-h-11 w-full items-start gap-3 p-4">
          <RowBody question={question} position={position} />
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
    </li>
  );
}

/**
 * The active list of the Perguntas tab (12-15, 12.1-16; D-582, D-623, D-627, UI-D-565..UI-D-567, UI-D-642..UI-D-646):
 * the actions row ("Adicionar pergunta", "Adicionar etapa", "Reordenar", "Ver como o membro vê"), the limit
 * lines, the "Perguntas ativas (n)" micro-title and the rows in the admin's order, which is the order
 * members see. **With one step (or none) the rows are the flat list of Phase 12; with two or more they sit
 * in step wells** under a one-time note, numbered across the whole form.
 *
 * **Reorder is a mode with buttons, never a drag** (a drag fights the scroll of a mobile page, and the
 * buttons are the keyboard alternative). Each press moves the row (or, on a well's header, the whole step),
 * SAVES AT ONCE with one write of the WHOLE layout through the server action, keeps focus on the same
 * button at its new position (re-applied after React moves the row, because a moved node loses focus; if
 * that button is now disabled at an edge, its sibling takes the focus) and announces the new position
 * through an `aria-live="polite"` region. **An arrow moves a question only inside its step.** A press that
 * would put an opener at or after a question it opens (or a step above the step that holds an opener of one
 * of its questions) moves NOTHING and toasts which two QUESTIONS conflict; the server's coded 409 for the
 * same rule, after a race, puts the list back and says the same sentence. A failed write puts the row back
 * and toasts; a lost permission or a module turned off ends in a refresh into the page's `notFound()`.
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
}: QuestionListProps) {
  const t = useTranslations('profileForm');
  const tAdmin = useTranslations('admin');
  const router = useRouter();
  const toast = useToast();

  // The server's list wins whenever it re-renders with a new one (after a refresh).
  const [source, setSource] = useState({ questions, steps });
  const [items, setItems] = useState(() => normalize(steps, questions));
  const [stepList, setStepList] = useState(steps);
  if (source.questions !== questions || source.steps !== steps) {
    setSource({ questions, steps });
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

  const wells = stepList.length > 1;
  const groups = groupByStep(stepList, items);
  const positions = new Map(items.map((question, at) => [question.id, at + 1] as const));

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
    nextGroups: AdminQuestion[][];
    focusId: string;
    delta: -1 | 1;
    announce: (flat: AdminQuestion[]) => string;
  }) {
    const { nextSteps, nextGroups, focusId, delta, announce } = change;
    const nextItems = nextGroups.flat();
    const direction: Direction = delta < 0 ? 'up' : 'down';

    const violation = orderViolation(nextItems);
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
              steps: nextSteps.map((step, at) => ({
                id: step.id,
                questionIds: (nextGroups[at] ?? []).map((question) => question.id),
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
    const at = groups.findIndex((rows) => rows.some((question) => question.id === id));
    const rows = groups[at];
    if (!rows) return;
    const from = rows.findIndex((question) => question.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= rows.length) return;

    const nextRows = rows.slice();
    const [moved] = nextRows.splice(from, 1);
    if (!moved) return;
    nextRows.splice(to, 0, moved);
    const nextGroups = groups.map((group, index) => (index === at ? nextRows : group));
    void apply({
      nextSteps: stepList,
      nextGroups,
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
    const nextGroups = groups.slice();
    const [movedRows] = nextGroups.splice(from, 1);
    nextGroups.splice(to, 0, movedRows ?? []);
    void apply({
      nextSteps,
      nextGroups,
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

  const renderRows = (rows: AdminQuestion[]) => (
    <ul className="flex flex-col gap-3">
      {rows.map((question, groupIndex) =>
        reordering ? (
          <ReorderRow
            key={question.id}
            question={question}
            position={positions.get(question.id) ?? groupIndex + 1}
            groupIndex={groupIndex}
            groupSize={rows.length}
            busy={busy}
            register={register}
            onMove={moveQuestion}
          />
        ) : (
          <QuestionRow
            key={question.id}
            question={question}
            position={positions.get(question.id) ?? groupIndex + 1}
            total={items.length}
            onOpen={onOpen}
          />
        ),
      )}
    </ul>
  );

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
              count={groups[at]?.length ?? 0}
              reordering={reordering}
              busy={busy}
              addDisabled={items.length >= limit}
              onRename={(target) => onRenameStep?.(target)}
              onAddQuestion={(target) => onAddToStep?.(target)}
              onMove={moveStep}
              register={register}
            >
              {renderRows(groups[at] ?? [])}
            </StepWell>
          ))}
        </div>
      ) : (
        renderRows(items)
      )}
    </section>
  );
}
