'use client';

import type { AdminMember } from '@rede-social/contracts/moderation';
import { Card, useToast } from '@rede-social/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { AdminMemberRow, memberName } from '@/components/admin/AdminMemberRow';
import { MemberAdminSheet, type MemberSheetSettled } from '@/components/admin/MemberAdminSheet';
import { blockMemberAction, unblockMemberAction } from './actions';

export interface AdminMembersListProps {
  /** Page 1, read on the server. */
  initialItems: AdminMember[];
  /** The tenant's display name, for the sheet's bodies and the refusal / gone copy. */
  tenantName: string;
  /** `moderation.manage` in `bootstrap.permissions`: the sheet's access action. */
  canModerate: boolean;
}

/**
 * The Membros list (ADMIN-02, D-340, UI-D-271/272): every membership of the tenant, each row opening
 * the ONE member admin sheet. A successful block or unblock updates the row IN PLACE with the
 * server's answer (no optimistic state, UI §Interaction), closes the sheet and toasts; a vanished
 * member toasts and refreshes; a lost permission toasts and refreshes into `notFound()` (UI-D-284).
 */
export function AdminMembersList({ initialItems, tenantName, canModerate }: AdminMembersListProps) {
  const t = useTranslations('admin');
  const tm = useTranslations('moderation.member');
  const router = useRouter();
  const { show } = useToast();

  const [items, setItems] = useState(initialItems);
  const [seeded, setSeeded] = useState(initialItems);
  if (seeded !== initialItems) {
    setSeeded(initialItems);
    setItems(initialItems);
  }

  const [selected, setSelected] = useState<AdminMember | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const openSheet = useCallback((member: AdminMember) => {
    setSelected(member);
    setOpen(true);
  }, []);

  const onAccess = useCallback(
    (membershipId: string, kind: 'block' | 'unblock', reason: string | undefined) =>
      kind === 'block'
        ? blockMemberAction(membershipId, reason ?? null)
        : unblockMemberAction(membershipId, reason ?? null),
    [],
  );

  const onSettled = useCallback(
    (outcome: MemberSheetSettled) => {
      setOpen(false);
      if (outcome.kind === 'changed') {
        const updated = outcome.member;
        setItems((rows) =>
          rows.map((row) => (row.membershipId === updated.membershipId ? updated : row)),
        );
        setSelected(updated);
        const name = memberName(updated);
        show({
          tone: 'success',
          message:
            outcome.change === 'block'
              ? tm('toasts.blocked', { name })
              : tm('toasts.unblocked', { name }),
        });
        return;
      }
      if (outcome.kind === 'gone') {
        show({ tone: 'error', message: t('members.errors.gone', { tenant: tenantName }) });
      } else {
        show({ tone: 'error', message: t('errors.forbidden') });
      }
      router.refresh();
    },
    [router, show, t, tm, tenantName],
  );

  return (
    <>
      <Card className="rounded-none bg-transparent shadow-none md:rounded-xl md:bg-card md:shadow-[0_1px_3px_rgba(22,35,59,.06)]">
        <ul aria-label={t('members.title')} data-admin-members>
          {items.map((member) => (
            <li key={member.membershipId} className="border-b border-divider last:border-0">
              <AdminMemberRow member={member} onOpen={openSheet} />
            </li>
          ))}
        </ul>
      </Card>
      <MemberAdminSheet
        member={selected}
        open={open}
        onClose={close}
        tenantName={tenantName}
        canModerate={canModerate}
        onAccess={onAccess}
        onSettled={onSettled}
      />
    </>
  );
}
