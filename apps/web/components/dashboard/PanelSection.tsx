import { Button, type ButtonVariant, cn, SectionTitle } from '@rede-social/ui';
import type { ReactNode } from 'react';

export interface DisabledActionProps {
  children: ReactNode;
  variant?: ButtonVariant;
}

/**
 * An action the real panel will have ("Ver todos", "Responder", "Enviar push"), drawn disabled: the
 * panel shows sample numbers with nothing behind them yet (`docs/pendencias-backend.md` item 10),
 * so nothing may look clickable that does nothing. Kept for parity with the rede-social-dashboard
 * screen the owner approved.
 */
export function DisabledAction({ children, variant = 'ghost' }: DisabledActionProps) {
  return (
    <Button variant={variant} size="sm" disabled>
      {children}
    </Button>
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
