'use client';

import type {
  MemberForm,
  MemberQuestion,
  ProfileFormIssue,
} from '@rede-social/contracts/profile-form';
import { Button, buttonClasses, Card, EmptyState, flashToast } from '@rede-social/ui';
import { CircleAlert, CircleCheck, Eye, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useRef, useState, useTransition } from 'react';
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
import { QuestionField, questionDomId } from './QuestionField';

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
}

type View = {
  questions: MemberQuestion[];
  formEtag: string;
  mode: 'first' | 'returning' | 'edit';
  missingRequired: number;
};

const ALERT_CLASS = 'rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger';

function viewOf(form: MemberForm): View {
  return {
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
  const [pending, startTransition] = useTransition();
  const [online, setOnline] = useState(true);
  const [summaryTick, setSummaryTick] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

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

  const { questions } = view;
  const locked = pending;
  const errorCount = Object.keys(errors).length;
  const firstInvalid = firstInvalidId(questions, errors);
  const isFlagged = (question: MemberQuestion) =>
    !preview && flagged.has(question.id) && isEmptyDraft(question.type, answers[question.id]);
  const firstFlagged = questions.find(isFlagged);

  function setDraft(question: MemberQuestion, next: Answers[string]) {
    setAnswers((previous) => ({ ...previous, [question.id]: next }));
    setErrors((previous) => (previous[question.id] ? without(previous, question.id) : previous));
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

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview || pending || !online) return;
    setNotice(null);
    const found = validateAll(questions, answers);
    if (Object.keys(found).length > 0) {
      showErrors(found);
      return;
    }
    startTransition(async () => {
      const result = await saveProfileFormAction({
        formEtag: view.formEtag,
        answers: wireAnswers(questions, answers),
        next,
        mode: view.mode,
      });
      if (result.ok) {
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
        setView(viewOf(merged.form));
        setAnswers(merged.answers);
        setErrors({});
        setFlagged(
          (previous) =>
            new Set([...[...previous].filter((id) => surviving.has(id)), ...merged.flagged]),
        );
        setNotice('changed');
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

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      aria-busy={pending || undefined}
      className="flex w-full flex-col gap-6"
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
            {firstFlagged ? (
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
        {questions.map((question) => (
          <QuestionField
            key={question.id}
            question={question}
            draft={answers[question.id] ?? emptyDraft(question.type)}
            onChange={(next) => setDraft(question, next)}
            disabled={locked}
            issue={errors[question.id] ?? null}
            flagged={isFlagged(question)}
          />
        ))}
      </Card>

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
      ) : (
        <Button
          type="submit"
          variant="brand"
          size="lg"
          fullWidth
          disabled={!online}
          loading={pending}
        >
          {pending ? t('saving') : t('save')}
        </Button>
      )}
    </form>
  );
}
