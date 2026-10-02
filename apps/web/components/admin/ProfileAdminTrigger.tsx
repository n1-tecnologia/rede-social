'use client';

import type { TenantRole } from '@rede-social/contracts';
import type { AdminMember } from '@rede-social/contracts/moderation';
import { IconButton, useToast } from '@rede-social/ui';
import { Ellipsis } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  blockMemberAction,
  changeMemberRoleAction,
  unblockMemberAction,
} from '@/app/(app)/configuracoes/membros/actions';
import { memberName } from './AdminMemberRow';
import { MemberAdminSheet, type MemberSheetSettled } from './MemberAdminSheet';
import { ROLE_KEY } from './RoleOptionList';

export interface ProfileAdminTriggerProps {
  /** The profile's membership, read through `GET /v1/admin/members/{id}` on the server. */
  member: AdminMember;
  tenantName: string;
  /** `moderation.manage`: the sheet's access action. */
  canModerate: boolean;
  /** `members.manage`: the sheet's role list. */
  canManageMembers: boolean;
}

/** Where a block from the profile lands: the profile no longer exists for that person (UI-D-275). */
const BLOCKED_LIST = '/configuracoes/membros?status=blocked';

/**
 * The admin entry on a member's profile (D-340, UI-D-275): a trailing 44px `IconButton` (`Ellipsis`
 * 22, "Ações de administração") in the profile's `PageHeader` that opens THE member admin sheet —
 * the same component the Membros list opens, without "Ver perfil" — so the two entry points can never
 * offer different actions.
 *
 * The PAGE renders this only for holders of `members.manage` or `moderation.manage`; for anyone else
 * it is absent from the DOM (T-08-30). The viewer's own profile redirects to `/perfil` before it
 * could render, so it can never target the viewer.
 *
 * Settling (UI-D-275, UI-D-284):
 * - a successful **block** toasts and navigates to the Membros list filtered to "Bloqueados", because
 *   the profile answers 404 for a blocked member from then on;
 * - a **role change** updates the open sheet in place and toasts (the sheet stays open);
 * - a **vanished member** (404) closes the sheet, toasts the gone copy and refreshes, after which the
 *   profile answers `notFound()`;
 * - a **lost permission** (403 `FORBIDDEN`) closes the sheet, toasts and refreshes, after which this
 *   trigger is gone; a 403 `MEMBERSHIP_BLOCKED` never reaches here (the server action navigates to the
 *   shipped "Acesso suspenso" flow).
 */
export function ProfileAdminTrigger({
  member: initial,
  tenantName,
  canModerate,
  canManageMembers,
}: ProfileAdminTriggerProps) {
  const t = useTranslations('admin');
  const tm = useTranslations('moderation.member');
  const router = useRouter();
  const { show } = useToast();
  const [member, setMember] = useState(initial);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  // The trigger lives in the sticky `PageHeader` (its own z-40 stacking context, under the z-50
  // TopBar), so the sheet is portalled to <body> to stack like the Membros list's sheet does.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  const onAccess = useCallback(
    (membershipId: string, kind: 'block' | 'unblock', reason: string | undefined) =>
      kind === 'block'
        ? blockMemberAction(membershipId, reason ?? null)
        : unblockMemberAction(membershipId, reason ?? null),
    [],
  );

  const onRole = useCallback(
    (membershipId: string, role: TenantRole) => changeMemberRoleAction(membershipId, role),
    [],
  );

  const onSettled = useCallback(
    (outcome: MemberSheetSettled) => {
      if (outcome.kind === 'role') {
        setMember(outcome.member);
        show({
          tone: 'success',
          message: t('members.toasts.roleChanged', {
            name: memberName(outcome.member),
            role: t(`roles.${ROLE_KEY[outcome.member.role]}`),
          }),
        });
        return;
      }
      setOpen(false);
      if (outcome.kind === 'changed') {
        const name = memberName(outcome.member);
        setMember(outcome.member);
        if (outcome.change === 'block') {
          show({ tone: 'success', message: tm('toasts.blocked', { name }) });
          router.push(BLOCKED_LIST);
          return;
        }
        show({ tone: 'success', message: tm('toasts.unblocked', { name }) });
        router.refresh();
        return;
      }
      show({
        tone: 'error',
        message:
          outcome.kind === 'gone'
            ? t('members.errors.gone', { tenant: tenantName })
            : t('errors.forbidden'),
      });
      router.refresh();
    },
    [router, show, t, tm, tenantName],
  );

  return (
    <>
      <IconButton
        data-profile-admin-trigger
        icon={Ellipsis}
        size={22}
        label={t('members.actions')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      />
      {portalTarget
        ? createPortal(
            <MemberAdminSheet
              member={member}
              open={open}
              onClose={close}
              tenantName={tenantName}
              canModerate={canModerate}
              canManageMembers={canManageMembers}
              showViewProfile={false}
              onAccess={onAccess}
              onRole={onRole}
              onSettled={onSettled}
            />,
            portalTarget,
          )
        : null}
    </>
  );
}
