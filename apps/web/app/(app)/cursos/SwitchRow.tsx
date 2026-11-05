'use client';

import { cn, Switch } from '@rede-social/ui';

export interface SwitchRowProps {
  /** The ids' stem: `{id}-label` and `{id}-helper` (the switch is described by its helper). */
  id: string;
  /** The hook family: the row carries `data-{hook}`, the helper `data-{hook}-helper`. */
  hook: string;
  label: string;
  /** What the switch changes for the member, or why it is off: said BEFORE the tap. */
  helper: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * 2026-10-22 — one on/off setting of the admin forms (the social-igoralves panel's `SwitchRow`): an
 * outlined block with the name (14/600), the helper under it (12, tertiary; what the switch changes
 * for the member, or the reason it is disabled) and the shipped `Switch` at the end, named by the
 * label and described by the helper. The module sheet's "Exige concluir o módulo anterior" and the
 * lesson form's "Aula aberta" and "Exige concluir a aula anterior" are this row; their hooks
 * (`data-module-requires`, `data-lesson-free-helper`…) and ids are kept through `hook` and `id`.
 * Every word arrives from the host (PWA-03).
 */
export function SwitchRow({
  id,
  hook,
  label,
  helper,
  checked,
  onChange,
  disabled = false,
  className,
}: SwitchRowProps) {
  const helperId = `${id}-helper`;
  return (
    <div
      {...{ [`data-${hook}`]: true }}
      className={cn(
        'flex items-start gap-3 rounded-xl border border-border bg-card px-3.5 py-3',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={`${id}-label`} className="text-sm font-semibold text-text">
          {label}
        </span>
        <span
          id={helperId}
          {...{ [`data-${hook}-helper`]: true }}
          className="text-xs font-normal leading-snug text-text-tertiary"
        >
          {helper}
        </span>
      </div>
      <Switch
        checked={checked}
        onChange={onChange}
        label={label}
        aria-describedby={helperId}
        disabled={disabled}
        className="mt-0.5"
      />
    </div>
  );
}
