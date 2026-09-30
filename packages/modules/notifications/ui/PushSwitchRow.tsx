'use client';

import { Switch } from '@rede-social/ui';
import { Bell } from 'lucide-react';

/** The six states of UI-D-256 (the web's `PushState` has the same members). */
export type PushRowState = 'checking' | 'unsupported' | 'ios-install' | 'off' | 'on' | 'denied';

export interface PushSwitchRowProps {
  state: PushRowState;
  /** The row label ("Notificações", `app.settings.rows.notifications`). */
  label: string;
  /** One sub-line per state except `checking`, whose line is empty (the host interpolates `{tenant}`). */
  subLines: Record<Exclude<PushRowState, 'checking'>, string>;
  /** The switch's accessible name ("Notificações neste aparelho"). */
  switchLabel: string;
  /** Subscribing or unsubscribing: the shipped `Switch busy`. */
  busy?: boolean;
  /** A tap: `true` asks to turn on (the host opens `InstallHint` for `ios-install`). */
  onToggle: (next: boolean) => void;
}

/** Disabled while the server render checks, and where a tap can do nothing (no API, denied). */
const DISABLED: ReadonlySet<PushRowState> = new Set(['checking', 'unsupported', 'denied']);

/**
 * The Configurações "Notificações" row as this device's on/off switch (D-233, UI-D-256, sketch 007
 * surface 4). Props-only: no words, no browser API. The settings `Row` geometry
 * (`flex w-full items-center gap-3 px-4 py-3.5`), `Bell` 20 secondary, a `min-w-0 flex-1` column with
 * the 14/400 label and the 12/400 tertiary sub-line (`mt-1`, `min-h-[18px]`, so the `checking` state
 * reserves the line and the row never jumps after mount), then the shipped `Switch` (`shrink-0`,
 * 44×24), which stays vertically centred while a long sub-line wraps.
 */
export function PushSwitchRow({
  state,
  label,
  subLines,
  switchLabel,
  busy = false,
  onToggle,
}: PushSwitchRowProps) {
  const subLine = state === 'checking' ? '' : subLines[state];
  return (
    <div data-push-row={state} className="flex w-full items-center gap-3 px-4 py-3.5">
      <Bell aria-hidden size={20} className="shrink-0 text-text-secondary" />
      <div className="min-w-0 flex-1">
        <span className="block text-sm text-text">{label}</span>
        <span data-push-subline className="mt-1 block min-h-[18px] text-xs text-text-tertiary">
          {subLine}
        </span>
      </div>
      <Switch
        checked={state === 'on'}
        onChange={onToggle}
        label={switchLabel}
        busy={busy}
        disabled={DISABLED.has(state)}
      />
    </div>
  );
}
