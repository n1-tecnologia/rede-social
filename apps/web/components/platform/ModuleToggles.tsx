'use client';

import { Card, StatusPill, Switch, useToast } from '@tria/ui';
import { useOptimistic, useState, useTransition } from 'react';
import type { SetModuleResult } from '@/app/(platform)/plataforma/tenants/[id]/modulos/actions';

/** One toggleable module as the server built it (name + description from 02-12's catalog). */
export type ModuleRowView = {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
};

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
 * value reverts to the server state and the error toast shows (E15/error). Rows come ONLY from
 * props (T-02-97).
 */
export function ModuleToggles({ tenantId, rows, labels, action }: ModuleTogglesProps) {
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [optimistic, setOptimistic] = useOptimistic(
    rows,
    (state: ModuleRowView[], patch: { key: string; enabled: boolean }) =>
      state.map((row) => (row.key === patch.key ? { ...row, enabled: patch.enabled } : row)),
  );

  const toggle = (key: string, next: boolean) => {
    if (pendingKeys.has(key)) return;
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
      }
    });
  };

  return (
    <Card className="flex flex-col">
      <ul className="flex flex-col">
        {optimistic.map((row) => {
          const busy = pendingKeys.has(row.key);
          return (
            <li
              key={row.key}
              className="flex min-h-14 items-center gap-3 border-b border-divider px-4 py-2 last:border-0"
              aria-busy={busy || undefined}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-text">{row.name}</p>
                <p className="line-clamp-2 text-xs text-text-tertiary">{row.description}</p>
              </div>
              <StatusPill tone={row.enabled ? 'success' : 'neutral'} className="shrink-0">
                {row.enabled ? labels.enabled : labels.disabled}
              </StatusPill>
              <Switch
                checked={row.enabled}
                onChange={(next) => toggle(row.key, next)}
                label={interpolate(labels.toggle, { module: row.name })}
                busy={busy}
              />
            </li>
          );
        })}
      </ul>
      <p className="px-4 py-3 text-xs text-text-tertiary">{labels.helper}</p>
    </Card>
  );
}
