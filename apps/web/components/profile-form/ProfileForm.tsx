'use client';

import type {
  MemberForm,
  MemberQuestion,
  MemberStep,
  ProfileFormIssue,
} from '@rede-social/contracts/profile-form';
import { Button, buttonClasses, Card, cn, EmptyState, flashToast } from '@rede-social/ui';
import { ArrowLeft, ArrowRight, CircleAlert, CircleCheck, Eye, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useRef, useState, useTransition } from 'react';
import { saveProfileFormAction } from '@/app/(auth)/completar-perfil/actions';
import {
  type Answers,
  emptyDraft,
  firstInvalidId,
  flaggedIds,
  initialAnswers,
  isEmptyDraft,
  mergeFreshForm,
  missingErrorIds,
  validateAll,
  wireAnswers,
} from '@/lib/profile-form/form-state';
import {
  firstStepWithMissing,
  isLastStep,
  nextStep,
  previousStep,
  showProgress,
  showSteps,
  stepPath,
} from '@/lib/profile-form/steps';
import { visibleQuestionIds } from '@/lib/profile-form/visibility';
import { QuestionField, questionDomId } from './QuestionField';
import { StepProgress } from './StepProgress';

/**
 * The member's completion screen as ONE form (12-12, D-582, D-583, UI-D-580..UI-D-588): every active
 * question in the admin's order, pre-filled with the stored answers, one "Salvar" at the end. The same
 * component serves the first answer, the return after a form change and a later edit (the mode is the
 * API's, never the URL's), and the builder's preview sheet (`preview`: every control is live, nothing is
 * ever sent).
 *
 * **Answers live in this component's state and nowhere else (T-12-30).** They are not written to browser
 * storage, a URL, a log or a toast; the only thing that leaves is the save action's body. The destination
 * after a save is whatever the server action returns (T-12-29): this component never reads `next` to
 * navigate. Every string is React text from the catalog (UI-D-598).
 *
 * **12.1: the first fill and the return are a stepper (D-628, D-629, D-630; UI-D-653, UI-D-654).** The layout is
 * chosen from the API's `mode`, never from the URL: `first` and `returning` walk the steps of the member's path
 * one at a time ("Avançar" validates the visible questions of the step, then saves the step with its `stepId`);
 * `edit` and the builder's preview keep the one-card layout of Phase 12. A form with a single configured step
 * has no step chrome at all and behaves exactly as Phase 12. The path comes from the pure `stepPath` and the
 * visibility rule from the contracts; the server revalidates every save and the SQL gate is the authority
 * (T-12.1-16).
 */

export interface ProfileFormProps {
  form: MemberForm;
  /** The raw `?next=` of the page; only handed to the save action, which validates it. */
  next?: string;
  /** The builder's "Como o membro vê": every control live, nothing sent, the viewer is a first-time member. */
  preview?: boolean;
  onClose?: () => void;
  /** The page heading and intro (the heading takes focus on mount). Absent in the preview. */
  title?: string;
  intro?: string;
  /**
   * `stepper` walks the steps of the member's path; `scroll` is the one-card layout. Absent: the stepper for
   * `first` and `returning` (outside the preview), the one card for `edit` and for the preview.
   */
  layout?: 'stepper' | 'scroll';
}

type View = {
  steps: MemberStep[];
  questions: MemberQuestion[];
  formEtag: string;
  mode: 'first' | 'returning' | 'edit';
  missingRequired: number;
};

const ALERT_CLASS = 'rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger';

function viewOf(form: MemberForm): View {
  return {
    steps: form.steps,
    questions: form.questions,
    formEtag: form.formEtag,
    mode: form.mode === 'none' ? 'first' : form.mode,
    missingRequired: form.missingRequired,
  };
}

function blankAnswers(form: Pick<MemberForm, 'questions'>): Answers {
  const answers: Answers = {};
  for (const question of form.questions) answers[question.id] = emptyDraft(question.type);
  return answers;
}

/**
 * The ordered step ids the member walks: the shared `stepPath` over the drafts, plus the `pinned` steps (the
 * ones already visited in this session) that still hold a visible question. The pins keep a step on a
 * returning path after the member answers what was missing in it, so the progress count does not shrink under
 * her while she types.
 */
function walkPath(view: View, answers: Answers, pinned: ReadonlySet<string>): string[] {
  const base = new Set(stepPath(view, answers, view.mode));
  const visible = visibleQuestionIds(view, answers);
  const holdsVisible = new Set(
    view.questions.filter((question) => visible.has(question.id)).map((q) => q.stepId),
  );
  return view.steps
    .filter((step) => base.has(step.id) || (pinned.has(step.id) && holdsVisible.has(step.id)))
    .map((step) => step.id);
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => id !== key));
}

export function ProfileForm({
  form,
  next,
  preview = false,
  onClose,
  title,
  intro,
  layout,
}: ProfileFormProps) {
  const t = useTranslations('profileForm.member');
  const router = useRouter();
  const [view, setView] = useState<View>(() => viewOf(form));
  const [answers, setAnswers] = useState<Answers>(() =>
    preview ? blankAnswers(form) : initialAnswers(form),
  );
  const [errors, setErrors] = useState<Record<string, ProfileFormIssue>>({});
  const [flagged, setFlagged] = useState<Set<string>>(
    () => new Set(!preview && form.mode === 'returning' ? flaggedIds(form) : []),
  );
  const [notice, setNotice] = useState<'failed' | 'changed' | null>(null);
  // The title of the step the gate sent the member back to (D-629, D-631), or null.
  const [elsewhere, setElsewhere] = useState<string | null>(null);
  // The sentence the single polite live region reads: titles and counts only (T-12.1-11).
  const [announcement, setAnnouncement] = useState('');
  const [pending, startTransition] = useTransition();
  const [online, setOnline] = useState(true);
  const [summaryTick, setSummaryTick] = useState(0);
  const [currentStepId, setCurrentStepId] = useState<string | null>(
    () => walkPath(viewOf(form), answers, new Set())[0] ?? null,
  );
  const [pinned, setPinned] = useState<ReadonlySet<string>>(
    () => new Set(currentStepId === null ? [] : [currentStepId]),
  );
  const [focusTick, setFocusTick] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const stepHeadingId = useId();

  // The heading takes focus on mount so a screen reader starts at the top (UI-D-596).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // `navigator.onLine`, kept current by the two window events (UI-D-587).
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  // A failed save moves the screen reader to the summary (UI-D-586).
  useEffect(() => {
    if (summaryTick > 0) summaryRef.current?.focus();
  }, [summaryTick]);

  // On every step change focus moves to the new step's heading and the page scrolls to it (UI-D-654, UI-D-660).
  useEffect(() => {
    if (focusTick === 0) return;
    const heading = stepHeadingRef.current;
    heading?.focus();
    heading?.scrollIntoView?.({ block: 'start' });
  }, [focusTick]);

  const { questions } = view;
  const locked = pending;
  const wantsStepper = layout ? layout === 'stepper' : !preview && view.mode !== 'edit';
  const path = wantsStepper ? walkPath(view, answers, pinned) : [];
  const stepperOn = wantsStepper && path.length > 0;
  const currentId = stepperOn
    ? currentStepId !== null && path.includes(currentStepId)
      ? currentStepId
      : (path[0] ?? null)
    : null;
  const chrome = stepperOn && showSteps(view);
  const visible = visibleQuestionIds(view, answers);
  // A conditional question that is hidden stays in the list so its reveal can animate out (UI-D-655).
  const stepQuestions = questions.filter(
    (question) =>
      (visible.has(question.id) || question.condition !== null) &&
      (!chrome || question.stepId === currentId),
  );
  const scope = chrome
    ? new Set(questions.filter((q) => q.stepId === currentId).map((q) => q.id))
    : undefined;
  const lastStep = !stepperOn || (currentId !== null && isLastStep(path, currentId));
  const singleStep = !stepperOn || path.length === 1;
  const previousId = stepperOn && currentId !== null ? previousStep(path, currentId) : null;
  const submitLabel = singleStep ? t('save') : lastStep ? t('stepper.finish') : t('stepper.next');
  const stepTitle = view.steps.find((step) => step.id === currentId)?.title ?? '';
  const errorCount = Object.keys(errors).length;
  const firstInvalid = firstInvalidId(questions, errors);
  const isFlagged = (question: MemberQuestion) =>
    !preview && flagged.has(question.id) && isEmptyDraft(question.type, answers[question.id]);
  const firstFlagged = questions.find(isFlagged);

  function setDraft(question: MemberQuestion, next: Answers[string]) {
    setAnswers((previous) => ({ ...previous, [question.id]: next }));
    setErrors((previous) => (previous[question.id] ? without(previous, question.id) : previous));
    announceReveal(visible, visibleQuestionIds(view, { ...answers, [question.id]: next }));
  }

  /**
   * What an answer opened or closed on the screen the member is looking at (the current step in the stepper,
   * the whole form otherwise). Focus never moves; this is the one announcement (UI-D-655).
   */
  function announceReveal(before: ReadonlySet<string>, after: ReadonlySet<string>) {
    const onScreen = (question: MemberQuestion) => !chrome || question.stepId === currentId;
    const appeared = questions.filter(
      (question) => onScreen(question) && after.has(question.id) && !before.has(question.id),
    );
    const gone = questions.filter(
      (question) => onScreen(question) && before.has(question.id) && !after.has(question.id),
    );
    const parts: string[] = [];
    if (appeared.length === 1) {
      parts.push(t('stepper.revealedOne', { title: appeared[0]?.title ?? '' }));
    } else if (appeared.length > 1) {
      parts.push(t('stepper.revealedMany', { count: appeared.length }));
    }
    if (gone.length > 0) parts.push(t('stepper.hidden', { count: gone.length }));
    setAnnouncement(parts.join(' '));
  }

  function showErrors(found: Record<string, ProfileFormIssue>) {
    setErrors(found);
    setFlagged((previous) => new Set([...previous, ...missingErrorIds(found)]));
    setNotice(null);
    setSummaryTick((tick) => tick + 1);
  }

  function focusFirstInvalid() {
    if (!firstInvalid) return;
    const wrapper = document.getElementById(questionDomId(firstInvalid));
    wrapper
      ?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
      )
      ?.focus();
  }

  /** Moves to a step of the path: the new heading takes focus, the old errors go away (UI-D-654). */
  function goToStep(stepId: string) {
    setPinned((previous) => new Set([...previous, ...(currentId ? [currentId] : []), stepId]));
    setCurrentStepId(stepId);
    setErrors({});
    setNotice(null);
    setElsewhere(null);
    setAnnouncement('');
    setFocusTick((tick) => tick + 1);
  }

  /** "Voltar" never validates and never saves: the drafts stay in state (UI-D-654, T-12.1-11). */
  function goBack() {
    if (pending || previousId === null) return;
    goToStep(previousId);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview || pending || !online) return;
    setNotice(null);
    setElsewhere(null);
    const found = validateAll(questions, answers, scope);
    if (Object.keys(found).length > 0) {
      showErrors(found);
      return;
    }
    startTransition(async () => {
      const result = await saveProfileFormAction({
        formEtag: view.formEtag,
        ...(chrome && currentId ? { stepId: currentId } : {}),
        answers: wireAnswers(questions, answers, scope),
        next,
        mode: view.mode,
      });
      if (result.ok) {
        // Not the last step: the save is stored and the member moves on, whatever the gate says (D-629).
        if (!lastStep) {
          const to = currentId === null ? null : nextStep(path, currentId);
          if (to !== null) goToStep(to);
          return;
        }
        if (result.destination === null) {
          // The gate still finds a visible required question unanswered: go to the first step that holds
          // one and say so (D-629, D-631). Nothing leaves the form before the server reports none.
          const target = firstStepWithMissing(view, result.missingQuestionIds);
          if (target === null) {
            setNotice('failed');
            return;
          }
          setFlagged((previous) => new Set([...previous, ...result.missingQuestionIds]));
          if (stepperOn) goToStep(target);
          setElsewhere(view.steps.find((step) => step.id === target)?.title ?? '');
          return;
        }
        // The toast crosses the navigation (it is shown by the screen the member lands on).
        const pathname = new URL(result.destination, window.location.href).pathname;
        flashToast({ tone: 'success', message: t('saved') }, pathname);
        router.push(result.destination);
        return;
      }
      if (result.code === 'invalid') {
        const known = new Set(questions.map((question) => question.id));
        const keyed = Object.fromEntries(
          Object.entries(result.errors).filter(([id]) => known.has(id)),
        );
        if (Object.keys(keyed).length > 0) showErrors(keyed);
        else setNotice('failed');
        return;
      }
      if (result.code === 'changed') {
        const merged = mergeFreshForm({ questions }, answers, result.form);
        const surviving = new Set(merged.form.questions.map((question) => question.id));
        const freshView = viewOf(merged.form);
        const freshPins = new Set([...pinned, ...(currentId ? [currentId] : [])]);
        setView(freshView);
        setAnswers(merged.answers);
        setPinned(freshPins);
        // Stay on the step; if it no longer holds a visible question, move to the next step of the path.
        if (currentId !== null) {
          const freshPath = walkPath(freshView, merged.answers, freshPins);
          const rank = (id: string) => freshView.steps.findIndex((step) => step.id === id);
          setCurrentStepId(
            freshPath.includes(currentId)
              ? currentId
              : (freshPath.find((id) => rank(id) > rank(currentId)) ?? freshPath.at(-1) ?? null),
          );
        }
        setErrors({});
        setFlagged(
          (previous) =>
            new Set([...[...previous].filter((id) => surviving.has(id)), ...merged.flagged]),
        );
        setNotice('changed');
        setElsewhere(null);
        setAnnouncement('');
        return;
      }
      setNotice('failed');
    });
  }

  if (questions.length === 0) {
    return (
      <EmptyState
        variant="card"
        icon={CircleCheck}
        title={t('none.title')}
        body={t('none.body')}
        action={
          preview ? undefined : (
            <Link href="/inicio" className={buttonClasses({ variant: 'outline', size: 'md' })}>
              {t('home')}
            </Link>
          )
        }
      />
    );
  }

  const questionsCard = (
    <Card className="flex flex-col gap-6 p-4">
      {errorCount > 0 ? (
        <div
          ref={summaryRef}
          role="alert"
          tabIndex={-1}
          className={`${ALERT_CLASS} flex flex-col items-start gap-1 outline-none`}
        >
          <p className="font-bold">{t('summary.title', { n: errorCount })}</p>
          {firstInvalid ? (
            <a
              href={`#${questionDomId(firstInvalid)}`}
              onClick={(event) => {
                event.preventDefault();
                focusFirstInvalid();
              }}
              className="inline-flex min-h-11 items-center font-bold underline"
            >
              {t('summary.jump')}
            </a>
          ) : null}
        </div>
      ) : null}
      {notice === 'changed' ? (
        <p role="alert" className={ALERT_CLASS}>
          {t('changed')}
        </p>
      ) : null}
      {stepQuestions.map((question) => (
        <QuestionField
          key={question.id}
          question={question}
          draft={answers[question.id] ?? emptyDraft(question.type)}
          onChange={(next) => setDraft(question, next)}
          disabled={locked}
          issue={errors[question.id] ?? null}
          flagged={isFlagged(question)}
          visible={visible.has(question.id)}
        />
      ))}
    </Card>
  );

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      aria-busy={pending || undefined}
      className={cn('flex w-full flex-col', chrome ? 'gap-4' : 'gap-6')}
    >
      {!preview && title ? (
        <header className="flex flex-col gap-2">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="break-words text-2xl font-bold tracking-[-0.02em] text-text outline-none"
          >
            {title}
          </h1>
          {intro ? <p className="break-words text-sm text-text-secondary">{intro}</p> : null}
        </header>
      ) : null}

      {preview ? (
        <p className="flex items-start gap-2 rounded-xl bg-bg-tertiary px-3 py-3 text-xs text-text">
          <Eye aria-hidden size={16} className="shrink-0" />
          {t('preview.banner')}
        </p>
      ) : null}

      {!preview && view.mode === 'returning' && view.missingRequired > 0 ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-3 text-xs text-text"
        >
          <CircleAlert aria-hidden size={16} className="shrink-0" />
          <p className="flex flex-col items-start">
            <span>{t('missing.notice', { n: view.missingRequired })}</span>
            {firstFlagged && !chrome ? (
              <a
                href={`#${questionDomId(firstFlagged.id)}`}
                className="inline-flex min-h-11 items-center font-bold text-brand underline"
              >
                {t('missing.jump')}
              </a>
            ) : null}
          </p>
        </div>
      ) : null}

      {chrome ? (
        <section aria-labelledby={stepHeadingId} className="flex flex-col gap-4">
          <StepProgress
            title={stepTitle}
            headingId={stepHeadingId}
            headingRef={stepHeadingRef}
            current={currentId === null ? 1 : path.indexOf(currentId) + 1}
            total={path.length}
            showProgress={showProgress(path)}
          />
          {questionsCard}
        </section>
      ) : (
        questionsCard
      )}

      {elsewhere !== null ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-3 text-xs text-text"
        >
          <CircleAlert aria-hidden size={16} className="shrink-0" />
          <p>{t('stepper.pendingElsewhere', { step: elsewhere })}</p>
        </div>
      ) : null}
      {!preview && !online ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl bg-bg-tertiary px-3 py-3 text-xs text-text"
        >
          <WifiOff aria-hidden size={16} className="shrink-0" />
          {t('offline')}
        </p>
      ) : null}
      {notice === 'failed' ? (
        <p role="alert" className={ALERT_CLASS}>
          {t('saveFailed')}
        </p>
      ) : null}

      {preview ? (
        <Button type="button" variant="outline" size="lg" fullWidth onClick={onClose}>
          {t('preview.close')}
        </Button>
      ) : chrome ? (
        <>
          <div className="flex gap-3">
            {previousId !== null ? (
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="shrink-0"
                disabled={locked}
                onClick={goBack}
              >
                <ArrowLeft aria-hidden size={18} />
                {t('stepper.back')}
              </Button>
            ) : null}
            <Button
              type="submit"
              variant="brand"
              size="lg"
              className="min-w-0 flex-1"
              disabled={!online}
              loading={pending}
            >
              {pending ? t('saving') : submitLabel}
              {!pending && !lastStep ? <ArrowRight aria-hidden size={18} /> : null}
            </Button>
          </div>
          {!lastStep ? (
            <p className="text-xs font-normal text-text-tertiary">{t('stepper.savedHint')}</p>
          ) : null}
        </>
      ) : (
        <Button
          type="submit"
          variant="brand"
          size="lg"
          fullWidth
          disabled={!online}
          loading={pending}
        >
          {pending ? t('saving') : submitLabel}
        </Button>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </form>
  );
}
