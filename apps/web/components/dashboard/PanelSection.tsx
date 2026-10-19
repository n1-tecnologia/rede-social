import { Button, type ButtonVariant, cn, SectionTitle } from '@rede-social/ui';
import type { ReactNode } from 'react';
import { ComingSoonPill } from './ComingSoon';

export interface DisabledActionProps {
  children: ReactNode;
  variant?: ButtonVariant;
  /**
   * The neutral "Em breve" pill (08.7-05, UI-D-478), worded by the host
   * (`dashboard.report.comingSoon.value`): for an action that needs a capability the app does not
   * have yet ("Enviar push", "Avisar sobre o próximo evento", the member-detail suggestions). It sits
   * 8px to the right of the button, in the same row, and is read after it. No tooltip: phones have no
   * hover, and a disabled button swallows pointer and focus events.
   */
  pill?: string;
}

/**
 * An action the real panel will have, drawn disabled: nothing may look clickable that does nothing.
 * Since 08.7-05 the ones that wait for a new capability carry the "Em breve" pill (`pill`); they
 * call no route (PR-4: no outreach from the panel in this phase).
 */
export function DisabledAction({ children, variant = 'ghost', pill }: DisabledActionProps) {
  const button = (
    <Button variant={variant} size="sm" disabled>
      {children}
    </Button>
  );
  if (!pill) return button;
  return (
    <span data-disabled-action className="inline-flex flex-wrap items-center gap-2">
      {button}
      <ComingSoonPill label={pill} />
    </span>
  );
}

export interface PanelSectionProps {
  title: string;
  /** The section's disabled action label, on the right of the title. */
  action?: string;
  /** The section's window ("Últimos 7 dias"), a quiet line on the right of the title. */
  period?: string;
  /** `h4` for a block nested in another section. */
  as?: 'h3' | 'h4';
  /** A section that groups other sections (e.g. the member's report) reads one level above them. */
  prominent?: boolean;
  children: ReactNode;
  className?: string;
  /** The section's anchor id (a link can land on it). */
  id?: string;
}

/** A titled block of a panel (h3 under the level's h2, or h4 inside another section). */
export function PanelSection({
  title,
  action,
  period,
  as = 'h3',
  prominent = false,
  children,
  className,
  id,
}: PanelSectionProps) {
  return (
    <section id={id} className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3">
        <SectionTitle
          as={as}
          variant="group"
          className={prominent ? 'text-lg font-extrabold text-text' : 'text-sm font-bold text-text'}
        >
          {title}
        </SectionTitle>
        {period ? (
          <span className="shrink-0 text-xs font-medium text-text-tertiary">{period}</span>
        ) : null}
        {action ? <DisabledAction>{action}</DisabledAction> : null}
      </div>
      {children}
    </section>
  );
}
