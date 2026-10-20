'use client';

import { Card, ConfirmDialog, StatusPill, Switch, useToast } from '@rede-social/ui';
import { type LucideIcon, Users } from 'lucide-react';
import { type ReactNode, useOptimistic, useState, useTransition } from 'react';
import type { SetModuleResult } from '@/app/(platform)/plataforma/tenants/[id]/modulos/actions';

/** One toggleable module as the server built it (name + description from 02-12's catalog). */
export type ModuleRowView = {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
};

/**
 * What a row may carry beyond name, description and switch (09-12, UI-D-505). All of it is built by
 * the server page from facts and catalog strings; the component keeps no module list of its own and
 * a row with no entry renders exactly as it always did.
 */
export interface ModuleRowExtras {
  /** 12px tertiary line under the description (the "requires Feed" explanation). */
  note?: string;
  /** The switch is disabled (`aria-disabled`) and calls nothing. */
  disabled?: boolean;
  /**
   * Switching the row ON opens the shipped `ConfirmDialog` with these strings instead of calling the
   * action; switching it OFF never confirms. `icon` defaults to `Users`.
   */
  confirmEnable?: {
    title: string;
    body: string;
    confirm: string;
    cancel: string;
    icon?: LucideIcon;
  };
  /** A control that belongs to the row (the "Configurar limites" button), under the description. */
  trailing?: ReactNode;
}

export interface ModuleTogglesLabels {
  helper: string;
  enabled: string;
  disabled: string;
  /** ICU template with `{module}` — the switch's accessible name. */
  toggle: string;
  saved: string;
  error: string;
}

export interface ModuleTogglesProps {
  tenantId: string;
  /** The six rows, server-built in contracts order — the component knows no module list of its own. */
  rows: ModuleRowView[];
  labels: ModuleTogglesLabels;
  /** `setModuleAction` — the API call + layout revalidation live in the server action. */
  action: (tenantId: string, key: string, enabled: boolean) => Promise<SetModuleResult>;
  /** Optional per-key extras (09-12), keyed by module key; built on the server. */
  extras?: Record<string, ModuleRowExtras>;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}

/**
 * Módulos tab (ROLE-04, MOD-04, D-16, mockup `tenant-page-modulos`): six `Switch` rows
 * (`min-h-14 px-4 border-b border-divider`), name 14/700 + description 12 tertiary + the
 * Ativado/Desativado pill + the switch, and the "30 seconds, no redeploy" helper. Toggling is
 * optimistic (`useOptimistic`): the switch flips at once and carries `aria-busy` until the action
 * settles; on success the revalidated `rows` prop carries the new value, on failure the optimistic
 * value reverts to the server state and the error toast shows (E15/error). Rows and their extras
 * come ONLY from props (T-02-97): the component knows no module list and no module-specific string.
 *
 * **Extras (09-12, UI-D-505).** A row may carry a requires note and a disabled switch, a trailing
 * control, and `confirmEnable`: switching that row ON opens the `ConfirmDialog` and only its confirm
 * runs the optimistic flow below (the dialog shows the shipped pending state while the action runs);
 * cancel clears it and leaves the switch where it was, writing nothing. Turning a row OFF never
 * confirms.
 */
export function ModuleToggles({ tenantId, rows, labels, action, extras }: ModuleTogglesProps) {
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [optimistic, setOptimistic] = useOptimistic(
    rows,
    (state: ModuleRowView[], patch: { key: string; enabled: boolean }) =>
      state.map((row) => (row.key === patch.key ? { ...row, enabled: patch.enabled } : row)),
  );

  const [confirming, setConfirming] = useState<string | null>(null);

  /** The optimistic flow; resolves when the action settles so the dialog can show its pending state. */
  const run = (key: string, next: boolean): Promise<void> =>
    new Promise<void>((resolve) => {
      startTransition(async () => {
        setOptimistic({ key, enabled: next });
        setPendingKeys((prev) => new Set(prev).add(key));
        try {
          const result = await action(tenantId, key, next);
          toast.show(
            result.ok
              ? { tone: 'success', message: labels.saved }
              : { tone: 'error', message: labels.error },
          );
        } finally {
          setPendingKeys((prev) => {
            const copy = new Set(prev);
            copy.delete(key);
            return copy;
          });
          resolve();
        }
      });
    });

  const toggle = (key: string, next: boolean) => {
    if (pendingKeys.has(key)) return;
    const extra = extras?.[key];
    if (extra?.disabled) return;
    if (next && extra?.confirmEnable) {
      setConfirming(key);
      return;
    }
    void run(key, next);
  };

  const confirmExtra = confirming ? extras?.[confirming]?.confirmEnable : undefined;

  return (
    <Card className="flex flex-col">
      <ul className="flex flex-col">
        {optimistic.map((row) => {
          const busy = pendingKeys.has(row.key);
          const extra = extras?.[row.key];
          return (
            <li
              key={row.key}
              className="flex min-h-14 items-center gap-3 border-b border-divider px-4 py-2 last:border-0"
              aria-busy={busy || undefined}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-text">{row.name}</p>
                <p className="line-clamp-2 text-xs text-text-tertiary">{row.description}</p>
                {extra?.note ? (
                  <p className="break-words text-xs text-text-tertiary">{extra.note}</p>
                ) : null}
                {extra?.trailing ? <div className="mt-2">{extra.trailing}</div> : null}
              </div>
              <StatusPill tone={row.enabled ? 'success' : 'neutral'} className="shrink-0">
                {row.enabled ? labels.enabled : labels.disabled}
              </StatusPill>
              <Switch
                checked={row.enabled}
                onChange={(next) => toggle(row.key, next)}
                label={interpolate(labels.toggle, { module: row.name })}
                busy={busy}
                disabled={extra?.disabled}
                aria-disabled={extra?.disabled || undefined}
              />
            </li>
          );
        })}
      </ul>
      <p className="px-4 py-3 text-xs text-text-tertiary">{labels.helper}</p>
      {confirmExtra && confirming ? (
        <ConfirmDialog
          open
          icon={confirmExtra.icon ?? Users}
          title={confirmExtra.title}
          body={confirmExtra.body}
          confirmLabel={confirmExtra.confirm}
          cancelLabel={confirmExtra.cancel}
          onConfirm={() => run(confirming, true)}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </Card>
  );
}
