'use client';

import {
  BOOTSTRAP_STEP_KEYS,
  type BootstrapReasonCode,
  type BootstrapStepKey,
  type BootstrapStepStatus,
} from '@rede-social/contracts/projects';
import { Button, Card, cn, SectionTitle, useToast } from '@rede-social/ui';
import { ChevronRight, Circle, CircleCheck, Loader2, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useTransition } from 'react';
import type { ResumeBootstrapResult } from '@/app/(platform)/plataforma/tenants/[id]/banco/actions';
import { reasonCatalogKey } from '@/lib/database-copy';

/** The tab refreshes its own data this often while the preparation is in progress (UI-D-537). */
export const POLL_INTERVAL_MS = 3000;

/** The part of a step row the card reads: its key, where it stands and why it failed. */
export type BootstrapStepView = {
  step: BootstrapStepKey;
  status: BootstrapStepStatus;
  reasonCode: BootstrapReasonCode | null;
};

export interface BootstrapStepsProps {
  tenantId: string;
  /** The API's rows, in ANY order: the card sorts them by `BOOTSTRAP_STEP_KEYS` (P101). */
  steps: ReadonlyArray<BootstrapStepView>;
  /** "12 de outubro de 2026" - computed on the server; null when the run has no recorded end. */
  finishedAtText: string | null;
  /** `resumeBootstrapAction` - the API call and the revalidation live in the server action. */
  resumeAction: (tenantId: string) => Promise<ResumeBootstrapResult>;
  /** `pollDatabaseAction` - true while the overview still answers; a refresh follows only a `true`. */
  pollAction: (tenantId: string) => Promise<boolean>;
}

const WORD_KEY = {
  pending: 'waiting',
  running: 'running',
  done: 'done',
  failed: 'failed',
} as const satisfies Record<BootstrapStepStatus, string>;

function StepGlyph({ status }: { status: BootstrapStepStatus }) {
  switch (status) {
    case 'running':
      return (
        <Loader2
          aria-hidden
          size={20}
          className="mt-px shrink-0 animate-spin text-text-secondary"
        />
      );
    case 'done':
      return <CircleCheck aria-hidden size={20} className="mt-px shrink-0 text-brand" />;
    case 'failed':
      return <XCircle aria-hidden size={20} className="mt-px shrink-0 text-danger" />;
    default:
      return <Circle aria-hidden size={20} className="mt-px shrink-0 text-text-tertiary" />;
  }
}

/**
 * The Preparação card of the Banco tab (09.2-19, UI-D-537, D-542, DBT-51): the eight bootstrap steps in
 * their FIXED order, the one verb that resumes a failed run, and a done state that does not keep eight
 * green rows on every tenant for ever.
 *
 *  - Order is the contract's (`BOOTSTRAP_STEP_KEYS`), never the API's or the timestamps' (P101); a row the
 *    API does not list reads as waiting.
 *  - Per state: waiting `Circle` tertiary, running `Loader2` spinning, done `CircleCheck` brand, failed
 *    `XCircle` danger with the catalog sentence of the reason CODE (never provider text) and "Código …".
 *    Every `li` also carries the state as a visually hidden word, so colour and glyph are never alone.
 *  - A failed step: the brand "Tentar de novo" (one resume per click: the button is `loading` and a ref
 *    guards a second call; a 409 is swallowed) and the note that finished steps are not redone.
 *  - In progress (no step failed, not all done): no button, the "Preparando…" note, and every 3 s the card
 *    asks the probe and, only if the API answers, calls `router.refresh()`. It stops the moment the run
 *    ends or fails. A probe that fails or throws changes nothing on screen (UI-D-544).
 *  - All done: one row "Preparação concluída em {date}." and a native `<details>` "Ver etapas" with the same
 *    list. Without a recorded date the full list stays on screen instead, so no sentence is invented.
 */
export function BootstrapSteps({
  tenantId,
  steps,
  finishedAtText,
  resumeAction,
  pollAction,
}: BootstrapStepsProps) {
  const t = useTranslations('platform.database');
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  const resumed = useRef(false);
  const ticking = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const rows = BOOTSTRAP_STEP_KEYS.map(
    (key): BootstrapStepView =>
      steps.find((row) => row.step === key) ?? { step: key, status: 'pending', reasonCode: null },
  );
  const failed = rows.some((row) => row.status === 'failed');
  const allDone = rows.every((row) => row.status === 'done');
  const inProgress = !failed && !allDone;

  // The latest router and probe, read by the interval without restarting it on every render.
  const latest = useRef({ router, pollAction, tenantId });
  latest.current = { router, pollAction, tenantId };

  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(async () => {
      if (ticking.current) return;
      ticking.current = true;
      try {
        const { router: current, pollAction: probe, tenantId: id } = latest.current;
        if (await probe(id)) current.refresh();
      } catch {
        // A failed tick keeps the last state on screen and tries again at the next one.
      } finally {
        ticking.current = false;
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [inProgress]);

  // After a resume settles and the step is still failed, focus returns to the button's slot (the shipped
  // `Button` is disabled while `loading`, so it can only take focus once the transition is over).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pending` is the trigger, `failed` is read once it ends
  useEffect(() => {
    if (pending || !resumed.current || !failed) return;
    rootRef.current?.querySelector<HTMLElement>('[data-steps-slot] button')?.focus();
  }, [pending]);

  // The button went away because the run moved on: focus lands on the card's heading (UI-D-545).
  useEffect(() => {
    if (failed || !resumed.current) return;
    resumed.current = false;
    rootRef.current?.querySelector<HTMLElement>('[data-steps-heading]')?.focus();
  }, [failed]);

  const resume = () => {
    if (sending.current) return;
    sending.current = true;
    resumed.current = true;
    startTransition(async () => {
      try {
        const result = await resumeAction(tenantId);
        if (!result.ok && result.error === 'generic') {
          toast.show({ tone: 'error', message: t('errors.generic') });
        }
      } catch {
        toast.show({ tone: 'error', message: t('errors.generic') });
      } finally {
        sending.current = false;
      }
      router.refresh();
    });
  };

  const list = (
    <ol aria-label={t('steps.listLabel')} className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.step} data-state={row.status} className="flex items-start gap-3">
          <StepGlyph status={row.status} />
          <div className="flex min-w-0 flex-col gap-1">
            <span
              className={cn(
                'break-words text-sm',
                row.status === 'pending' ? 'text-text-tertiary' : 'text-text',
              )}
            >
              {t(`steps.${row.step}`)}
              <span className="sr-only"> {t(`steps.status.${WORD_KEY[row.status]}`)}</span>
            </span>
            {row.status === 'failed' ? (
              <>
                <span className="break-words text-xs text-danger">
                  {t(`reasons.${reasonCatalogKey(row.reasonCode)}`)}
                </span>
                {row.reasonCode ? (
                  <span className="break-words text-xs text-text-tertiary">
                    {t('notices.code', { code: row.reasonCode })}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );

  const collapsed = allDone && finishedAtText !== null;

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-6">
      <div ref={rootRef} className="flex flex-col gap-4">
        <SectionTitle variant="micro" data-steps-heading tabIndex={-1} className="outline-none">
          {t('steps.title')}
        </SectionTitle>

        {collapsed ? (
          <>
            <div className="flex items-start gap-3">
              <CircleCheck aria-hidden size={20} className="mt-px shrink-0 text-brand" />
              <p className="min-w-0 break-words text-sm text-text">
                {t('steps.done', { date: finishedAtText })}
              </p>
            </div>
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  aria-hidden
                  size={16}
                  className="shrink-0 transition-transform group-open:rotate-90"
                />
                {t('steps.show')}
              </summary>
              <div className="pt-2">{list}</div>
            </details>
          </>
        ) : (
          list
        )}

        {failed ? (
          <div data-steps-slot className="flex flex-col gap-2">
            <Button
              variant="brand"
              loading={pending}
              onClick={resume}
              className="w-full md:w-auto md:self-start"
            >
              {pending ? t('steps.retrying') : t('steps.retry')}
            </Button>
            <p className="break-words text-xs text-text-tertiary">{t('steps.retryNote')}</p>
          </div>
        ) : null}

        {inProgress ? (
          <p aria-live="polite" className="break-words text-xs text-text-tertiary">
            {t('steps.running')}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
