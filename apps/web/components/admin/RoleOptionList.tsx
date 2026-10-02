'use client';

import type { TenantRole } from '@rede-social/contracts';
import { ConfirmDialog } from '@rede-social/ui';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** The display order of UI-D-273: Membro, Suporte, Administrador. */
export const ROLE_OPTIONS = [
  'member',
  'support_tenant',
  'admin_tenant',
] as const satisfies readonly TenantRole[];

/** The catalog key of each role under `admin.roles.*`. */
export const ROLE_KEY: Record<TenantRole, 'member' | 'support' | 'admin'> = {
  member: 'member',
  support_tenant: 'support',
  admin_tenant: 'admin',
};

/** The per-target confirm body under `admin.members.roleConfirm.*`. */
const CONFIRM_KEY: Record<TenantRole, 'toMember' | 'toSupport' | 'toAdmin'> = {
  member: 'toMember',
  support_tenant: 'toSupport',
  admin_tenant: 'toAdmin',
};

/** A refusal the list explains inline. Anything the server adds later reads as `generic`. */
export type RoleRefusal = 'self' | 'last_admin' | 'not_active' | 'generic';

const REFUSAL_KEY: Record<RoleRefusal, 'self' | 'lastAdmin' | 'notActive' | 'generic'> = {
  self: 'self',
  last_admin: 'lastAdmin',
  not_active: 'notActive',
  generic: 'generic',
};

export interface RoleOptionListProps {
  /** The membership's CURRENT role, as the server last answered it. The list never moves it itself. */
  value: TenantRole;
  /** The member's name, for the confirm title and body. */
  name: string;
  /** Interpolated into the last-admin refusal. */
  tenantName: string;
  /** A blocked membership: the list is shown disabled with the helper (UI E05/partial). */
  disabled?: boolean;
  /**
   * The confirmed change. Resolves `null` when the host took it over (success, a vanished member, a
   * lost permission), or the refusal to explain inline. The list never predicts a D-332 guard.
   */
  onChange: (role: TenantRole) => Promise<RoleRefusal | null>;
}

/**
 * The role list of the member admin sheet (ADMIN-02, D-332, UI-D-273, UI-D-288).
 *
 * - **A named `radiogroup`** (`aria-labelledby` the visible "Papel") of three `<button role="radio">`
 *   options, each with its label and description; the brand `Check` 20 marks the CURRENT role only
 *   (the UI-D-206 rule: the check is the control's only brand ink). The check slot is aligned to the
 *   first line (`items-start`), so a description that wraps at 320px never drags it down.
 * - **Keyboard.** One tab stop (roving `tabIndex` on the checked option); the arrow keys, Home and End
 *   move focus between the three options. Moving focus never changes a role: choosing one (click,
 *   Space or Enter) opens the confirm, because every role change is confirmed (UI-D-273).
 * - **Confirm.** Choosing a different role opens `ConfirmDialog tone="brand"` with the role-specific
 *   body; choosing the current role does nothing. Cancelling leaves the selection unchanged. The
 *   dialog is portalled to `<body>`, so it covers the screen and its exit never depends on the sheet's.
 * - **No optimistic selection.** `aria-checked` always reflects `value`, the server's answer. After
 *   the confirm the dialog stays in its pending state (spinner, both buttons disabled) and the group
 *   is `aria-busy` and `inert` until the server answers; then the dialog closes. Success arrives as a
 *   new `value` from the host, and a refusal leaves `value` where it was (the selection "reverts")
 *   and renders the inline `role="alert"` line under the list.
 * - **Disabled** (a blocked membership): `aria-disabled` on the group and every option, opacity 50,
 *   choosing does nothing, and the helper "Desbloqueie o acesso para mudar o papel." is the group's
 *   description. It is NOT `inert`, so assistive technology still reads the current role.
 */
export function RoleOptionList({
  value,
  name,
  tenantName,
  disabled = false,
  onChange,
}: RoleOptionListProps) {
  const t = useTranslations('admin');
  const tm = useTranslations('moderation.member');
  const labelId = useId();
  const helperId = useId();
  // The role being confirmed. It outlives the dialog's exit animation, so the body never blanks.
  const [candidate, setCandidate] = useState<TenantRole | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState<RoleRefusal | null>(null);
  const [pending, setPending] = useState(false);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // The confirm is portalled to <body>: rendered inside the sheet's animated panel, a sheet that
  // closes while the confirm is still leaving (a vanished member, a lost permission) never finished
  // either exit. Client-only, so the server render has no portal target to need.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  // A new server value (success, or a different membership) clears a stale refusal.
  const [shownValue, setShownValue] = useState(value);
  if (shownValue !== value) {
    setShownValue(value);
    setRefusal(null);
  }

  const choose = (role: TenantRole) => {
    if (disabled || pending || role === value) return;
    setRefusal(null);
    setCandidate(role);
    setConfirming(true);
  };

  /**
   * The confirmed request. `ConfirmDialog` awaits it, so the dialog shows its own pending state and
   * closes once the server has answered; meanwhile the group behind it is `aria-busy` and `inert`.
   */
  const confirm = async () => {
    const role = candidate;
    if (role === null) return;
    setPending(true);
    let outcome: RoleRefusal | null;
    try {
      outcome = await onChange(role);
    } catch (error) {
      console.error('admin.members.role_failed', { error: String(error) });
      outcome = 'generic';
    }
    setPending(false);
    setRefusal(outcome);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = ROLE_OPTIONS.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight')
      next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft')
      next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    optionRefs.current[next]?.focus();
  };

  return (
    <div data-role-list className="flex flex-col">
      <span id={labelId} className="mb-2 text-sm font-bold text-text">
        {t('members.roleLabel')}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={disabled ? helperId : undefined}
        aria-disabled={disabled || undefined}
        aria-busy={pending || undefined}
        inert={pending}
        className={`flex flex-col gap-1 rounded-xl bg-bg-input p-1 ${disabled ? 'opacity-50' : ''}`}
      >
        {ROLE_OPTIONS.map((role, index) => {
          const checked = role === value;
          return (
            // biome-ignore lint/a11y/useSemanticElements: UI-D-273/UI-D-288 — a two-line option (label + description) that opens a confirm instead of checking itself; a native radio would check on arrow keys and could not hold the description row
            <button
              key={role}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-disabled={disabled || undefined}
              data-role-option={role}
              tabIndex={checked ? 0 : -1}
              onClick={() => choose(role)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className="flex min-h-11 w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                {checked ? <Check aria-hidden size={20} className="text-brand" /> : null}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-bold text-text">{t(`roles.${ROLE_KEY[role]}`)}</span>
                <span className="text-xs font-normal text-text-tertiary">
                  {t(`roles.descriptions.${ROLE_KEY[role]}`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {disabled ? (
        <p
          id={helperId}
          data-role-list-helper
          className="mt-2 text-xs font-normal text-text-tertiary"
        >
          {t('members.roleBlockedHelper')}
        </p>
      ) : null}
      {refusal ? (
        <p data-role-list-error role="alert" className="mt-2 text-sm font-normal text-danger">
          {tm(`errors.${REFUSAL_KEY[refusal]}`, { tenant: tenantName })}
        </p>
      ) : null}
      {portalTarget
        ? createPortal(
            <ConfirmDialog
              open={confirming && candidate !== null}
              tone="brand"
              title={t('members.roleConfirm.title', { name })}
              body={
                candidate === null
                  ? undefined
                  : t(`members.roleConfirm.${CONFIRM_KEY[candidate]}`, { name })
              }
              confirmLabel={t('members.roleConfirm.confirm')}
              cancelLabel={t('members.roleConfirm.cancel')}
              onConfirm={confirm}
              onClose={() => setConfirming(false)}
            />,
            portalTarget,
          )
        : null}
    </div>
  );
}
