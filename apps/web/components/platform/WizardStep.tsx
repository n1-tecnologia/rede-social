import { LinkButton } from '@/app/(auth)/LinkButton';

type StepLink = { href: string; label: string };

/**
 * The step heading of the tenant wizard: the step title (h2 under the page's "Novo tenant") and its
 * line. The line names the tenant (the invite step, its first admin's e-mail too), and Dados takes a
 * name of up to 60 characters with no format rule: `break-words` breaks a word wider than the column
 * inside it, where it would push the whole step sideways.
 */
export function WizardStepIntro({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-bold tracking-[-0.01em] text-text">{title}</h2>
      <p className="break-words text-sm text-text-secondary">{body}</p>
    </div>
  );
}

export interface WizardStepNavProps {
  back?: StepLink;
  /** The primary move (brand fill). */
  next?: StepLink;
  /** A secondary move beside the primary one (ghost). */
  extra?: StepLink;
}

/**
 * The step row's footer. Every move is a `LinkButton` (`next/link`): a soft navigation between
 * children of `novo/layout.tsx`, so the preview device never remounts.
 */
export function WizardStepNav({ back, next, extra }: WizardStepNavProps) {
  return (
    <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        {back ? (
          <LinkButton href={back.href} variant="ghost">
            {back.label}
          </LinkButton>
        ) : null}
      </div>
      <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center">
        {extra ? (
          <LinkButton href={extra.href} variant="ghost">
            {extra.label}
          </LinkButton>
        ) : null}
        {next ? (
          <LinkButton href={next.href} variant="brand" size="lg">
            {next.label}
          </LinkButton>
        ) : null}
      </div>
    </div>
  );
}
