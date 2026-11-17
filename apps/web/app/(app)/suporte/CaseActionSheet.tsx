'use client';

import type { ChatCaseAction } from '@rede-social/module-chat/contracts';
import { BottomSheet, cn } from '@rede-social/ui';
import {
  CircleCheck,
  History,
  Lock,
  type LucideIcon,
  Pencil,
  RotateCcw,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CaseActionKind } from './useCaseActions';

/**
 * The "Mais ações" sheet of the team's case bar (UI-D-826) [designed]: a `BottomSheet` (the centred card from
 * `md`) of rows, each `min-h-12` with a 20px glyph and a 16/400 label.
 *
 * **It draws the server's list, never a role or a state.** Every row is an entry of the `actions[]` the API
 * sent for this viewer and this state, in the server's own order (T-12.4-69); a row that is not listed is NOT
 * rendered (never a disabled row with no reason), so "Atribuir a…" only exists for a viewer the server lets
 * assign and "Editar…" never on a closed case. "Ver detalhes e histórico" is always there, so a closed
 * case's menu holds that row alone. "Fechar" reads in the danger colour. There is no row that hands a case back with no owner (A-UI-10).
 *
 * A row taps once and the sheet closes. Resolve, close, reopen and take go to the bar (`onAction`, which
 * asks first when the matrix says so); assign, edit and details are other sheets the thread pane mounts
 * (`onOpenSheet`, plan 19).
 */

export type StaffSheetKind = 'assign' | 'edit' | 'details';

const ROWS: Record<ChatCaseAction, { Icon: LucideIcon; key: string }> = {
  take: { Icon: UserCheck, key: 'action.take' },
  assign: { Icon: UserPlus, key: 'action.assign' },
  resolve: { Icon: CircleCheck, key: 'action.resolve' },
  reopen: { Icon: RotateCcw, key: 'action.reopen' },
  close: { Icon: Lock, key: 'action.close' },
  edit: { Icon: Pencil, key: 'action.edit' },
};

export interface CaseActionSheetProps {
  open: boolean;
  onClose: () => void;
  /** What the server listed for this viewer and this state, untouched. */
  actions: readonly ChatCaseAction[];
  onAction: (kind: CaseActionKind) => void;
  onOpenSheet: (kind: StaffSheetKind) => void;
}

function Row({
  Icon,
  label,
  danger,
  onClick,
}: {
  Icon: LucideIcon;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left text-base font-normal',
          'hover:bg-bg-hover active:bg-bg-tertiary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
          danger ? 'text-danger' : 'text-text',
        )}
      >
        <Icon aria-hidden size={20} className="shrink-0" />
        <span className="min-w-0 flex-1">{label}</span>
      </button>
    </li>
  );
}

export function CaseActionSheet({
  open,
  onClose,
  actions,
  onAction,
  onOpenSheet,
}: CaseActionSheetProps) {
  const t = useTranslations('chat');

  const choose = (run: () => void) => () => {
    onClose();
    run();
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={t('action.more')} desktopCard>
      <ul className="flex flex-col">
        {actions.map((action) => {
          const { Icon, key } = ROWS[action];
          const run =
            action === 'assign'
              ? () => onOpenSheet('assign')
              : action === 'edit'
                ? () => onOpenSheet('edit')
                : () => onAction(action);
          return (
            <Row
              key={action}
              Icon={Icon}
              label={t(key)}
              danger={action === 'close'}
              onClick={choose(run)}
            />
          );
        })}
        <Row
          Icon={History}
          label={t('action.details')}
          onClick={choose(() => onOpenSheet('details'))}
        />
      </ul>
    </BottomSheet>
  );
}
