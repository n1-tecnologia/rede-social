'use client';

import { cn } from '@rede-social/ui';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useSelectedLayoutSegments } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTenantDraft } from './wizard/TenantDraftProvider';

/**
 * The wizard's steps. The first four collect the draft before the tenant exists (static children of
 * `/plataforma/novo`); the fifth, the first admin's invite, is a child of `/plataforma/novo/{id}`,
 * after the summary's confirmation created the tenant.
 */
const STEPS = [
  { key: 'data', segment: null, href: '/plataforma/novo' },
  { key: 'brand', segment: 'marca', href: '/plataforma/novo/marca' },
  { key: 'domain', segment: 'dominio', href: '/plataforma/novo/dominio' },
  { key: 'summary', segment: 'resumo', href: '/plataforma/novo/resumo' },
  { key: 'invite', segment: 'convite', href: null },
] as const;

type StepView = { done: boolean; current: boolean; link: string | null; name: string };

/**
 * The tenant wizard's step row, rendered by `/plataforma/novo`'s layout (so it persists across the
 * steps like the preview device). It reads the selected child segments: none on Dados, `[step]` on
 * the other draft steps, `[id, 'convite']` once the tenant exists.
 *
 * Before creation the user moves back and forth freely, each step open once the ones before it
 * pass: Dados is always a link, Personalização once Dados passed its validation (the draft's
 * `dataReady`), Domínio once the colours pass too (`brandReady`), and Resumo once the host was
 * checked as well (`hostReady`: a host typed on Domínio and never checked keeps it closed); the
 * invite is announced as available after creating. After creation the four draft steps are done
 * for good (the tenant exists, the slug is fixed) and the invite is current. Links are `next/link`
 * (soft navigation: an `<a>` would reload the document, the draft and the device with it).
 */
export function WizardSteps() {
  const t = useTranslations('platform.wizard.steps');
  const segments = useSelectedLayoutSegments();
  const { draft, brandReady } = useTenantDraft();
  const created = segments[1] === 'convite';
  const currentIndex = created
    ? STEPS.length - 1
    : Math.max(
        0,
        STEPS.findIndex((step) => step.segment === (segments[0] ?? null)),
      );

  const views: StepView[] = STEPS.map((step, index) => {
    const label = t(step.key);
    const current = index === currentIndex;
    if (created) {
      const done = index < currentIndex;
      return { done, current, link: null, name: done ? t('completed', { step: label }) : label };
    }
    if (step.href === null) {
      return { done: false, current, link: null, name: t('upcoming', { step: label }) };
    }
    // What keeps this step closed, if anything: the first earlier step that does not pass.
    const blocker =
      index === 0
        ? null
        : !draft.dataReady
          ? 'locked'
          : index >= 2 && !brandReady
            ? 'lockedBrand'
            : step.key === 'summary' && !draft.hostReady
              ? 'lockedDomain'
              : null;
    const done = index < currentIndex && draft.dataReady;
    return {
      done,
      current,
      link: !current && blocker === null ? step.href : null,
      name: current
        ? label
        : blocker
          ? t(blocker, { step: label })
          : done
            ? t('completed', { step: label })
            : label,
    };
  });

  return (
    <nav aria-label={t('label')} className="@container">
      <ol className="flex items-center gap-2">
        {STEPS.map((step, index) => {
          const view = views[index] as StepView;
          const reachable = view.current || view.done || view.link !== null;
          const body = (
            <>
              <span
                aria-hidden
                className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold transition-colors',
                  view.done && 'bg-brand text-on-brand',
                  !view.done && view.current && 'border-2 border-brand text-brand',
                  !view.done &&
                    !view.current &&
                    reachable &&
                    'border border-border-secondary text-text-secondary',
                  !reachable && 'border border-border text-text-tertiary',
                )}
              >
                {view.done ? <Check size={15} strokeWidth={2.6} /> : index + 1}
              </span>
              <span
                aria-hidden
                className={cn(
                  'truncate text-sm',
                  // The five labels need about 39rem of ROW (not of window: from xl up the device
                  // column beside the form grows with the window's height and narrows the form).
                  // Narrower, only the current step keeps its label; the numbers stay.
                  view.current
                    ? 'font-bold text-text'
                    : 'hidden text-text-secondary @min-[39rem]:block',
                  !reachable && 'text-text-tertiary',
                )}
              >
                {t(step.key)}
              </span>
              <span className="sr-only">{view.name}</span>
            </>
          );
          return (
            <li
              key={step.key}
              className={cn(
                'flex min-w-0 items-center gap-2',
                // The current step never gives up its label. In a narrow row the others (a number
                // each) share what is left; in a wide one each starts from its own label, so none
                // is cut.
                view.current ? 'flex-[1_0_auto]' : 'flex-1 @min-[39rem]:flex-auto',
              )}
            >
              {view.link ? (
                <Link
                  href={view.link}
                  className="flex min-h-[44px] min-w-0 items-center gap-2 rounded-full pr-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  {body}
                </Link>
              ) : (
                <span
                  aria-current={view.current ? 'step' : undefined}
                  className="flex min-h-[44px] min-w-0 items-center gap-2 pr-2"
                >
                  {body}
                </span>
              )}
              {index < STEPS.length - 1 ? (
                <span aria-hidden className="h-px min-w-2 flex-1 bg-border" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
