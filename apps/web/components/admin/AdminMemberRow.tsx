'use client';

import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import type { AdminMember } from '@rede-social/contracts/moderation';
import { Avatar, Skeleton, StatusPill } from '@rede-social/ui';
import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MediaImage } from '@/components/media/MediaImage';

/** What a row shows as its name line: the profile name, or the e-mail when there is none (UI-D-272). */
export function memberName(member: Pick<AdminMember, 'displayName' | 'email'>): string {
  return member.displayName ?? member.email;
}

/**
 * The pill line (UI-D-272, UI E03/zero-one-many): "Você" (brand) on the viewer's own row, the role
 * (neutral "Administrador" / "Suporte"; a plain "Membro" has no pill), then the status (danger
 * "Bloqueado" or warning "Convite pendente"). Returns `null` — no line at all — when nothing applies.
 * Pills WRAP on their own line, so the name keeps the full width at 320px.
 */
export function MemberPills({ member }: { member: AdminMember }) {
  const t = useTranslations('admin');
  const pills: { key: string; tone: 'brand' | 'neutral' | 'danger' | 'warning'; label: string }[] =
    [];
  if (member.isViewer) pills.push({ key: 'you', tone: 'brand', label: t('members.pills.you') });
  if (member.role === 'admin_tenant') {
    pills.push({ key: 'role', tone: 'neutral', label: t('roles.admin') });
  } else if (member.role === 'support_tenant') {
    pills.push({ key: 'role', tone: 'neutral', label: t('roles.support') });
  }
  if (member.status === 'blocked') {
    pills.push({ key: 'status', tone: 'danger', label: t('members.pills.blocked') });
  } else if (member.status === 'invited') {
    pills.push({ key: 'status', tone: 'warning', label: t('members.pills.invited') });
  }
  if (pills.length === 0) return null;
  return (
    <span data-member-pills className="mt-1 flex flex-wrap gap-1">
      {pills.map((pill) => (
        <StatusPill key={pill.key} tone={pill.tone}>
          {pill.label}
        </StatusPill>
      ))}
    </span>
  );
}

/** The 40px (row) or 56px (sheet) photo, with the neutral `User` avatar as the whole fallback. */
export function MemberAvatar({ member, size }: { member: AdminMember; size: 'md' | 'lg' }) {
  const name = memberName(member);
  const box = size === 'lg' ? 'h-14 w-14' : 'h-10 w-10';
  if (!member.avatarAssetId) return <Avatar size={size} alt={name} />;
  return (
    <MediaImage
      assetId={member.avatarAssetId}
      widths={PURPOSE_WIDTHS.avatar}
      baseWidth={128}
      alt={name}
      sizes={size === 'lg' ? '56px' : '40px'}
      ratio="aspect-square"
      className={`${box} shrink-0 rounded-full`}
      fallback={<Avatar size={size} alt={name} />}
    />
  );
}

/** The row body: avatar, name, e-mail (only when the name line is not already the e-mail), pills. */
function RowBody({ member }: { member: AdminMember }) {
  return (
    <>
      <span className="shrink-0">
        <MemberAvatar member={member} size="md" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span data-member-name className="truncate text-sm font-bold text-text">
          {memberName(member)}
        </span>
        {member.displayName !== null ? (
          <span data-member-email className="truncate text-xs font-normal text-text-tertiary">
            {member.email}
          </span>
        ) : null}
        <MemberPills member={member} />
      </span>
    </>
  );
}

const ROW =
  'flex w-full min-h-18 items-center gap-3 px-4 py-3 text-left text-text transition-colors';

export interface AdminMemberRowProps {
  member: AdminMember;
  /** Opens the member admin sheet for this row. Never called for the viewer's own row. */
  onOpen: (member: AdminMember) => void;
}

/**
 * One Membros row (UI-D-272). The WHOLE row is one `<button>` that opens the sheet — a list row opens
 * an in-place surface, so it is a button, not a link (UI-D-288). The viewer's own row is a static
 * `<div>` with the same geometry, the "Você" pill and NO chevron: no self action exists (D-332), so
 * no control is offered. Names and e-mails are plain React text (no raw HTML anywhere).
 */
export function AdminMemberRow({ member, onOpen }: AdminMemberRowProps) {
  if (member.isViewer) {
    return (
      <div data-member-row={member.membershipId} data-member-own className={ROW}>
        <RowBody member={member} />
      </div>
    );
  }
  return (
    <button
      type="button"
      data-member-row={member.membershipId}
      onClick={() => onOpen(member)}
      className={`${ROW} hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand md:hover:bg-card-hover`}
    >
      <RowBody member={member} />
      <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
    </button>
  );
}

/** `count` row skeletons in the row's own geometry (UI-D-283): 8 on a query change, 3 at the sentinel. */
export function AdminMemberSkeleton({ count }: { count: number }) {
  return (
    <div aria-busy data-admin-members-skeleton className="flex flex-col">
      {Array.from({ length: count }, (_, index) => index).map((index) => (
        <div
          key={index}
          className="flex min-h-18 items-center gap-3 border-b border-divider px-4 py-3 last:border-0"
        >
          <Skeleton variant="circle" className="h-10 w-10" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton variant="text" width="45%" className="h-3.5" />
            <Skeleton variant="text" width="65%" className="h-3" />
          </div>
        </div>
      ))}
    </div>
  );
}
