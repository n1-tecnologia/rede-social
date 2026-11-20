'use client';

import { TenantLogo } from '@rede-social/core/ui';
import { InboxRow } from '@rede-social/module-chat/ui';
import { Badge } from '@rede-social/ui';
import { Headset, Mic } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type MouseEvent, useCallback } from 'react';
import type {
  ConversationRowView,
  ConversationsPageView,
  PreviewKind,
  SupportRowView,
} from '@/lib/chat-view';

export interface ConversationsListProps {
  /** Page 1, finished by the server in the tenant clock (UI-D-862); `null` when the server could not read it. */
  initial: ConversationsPageView | null;
  /** The tenant's display name and logo, for the pinned support row's avatar. */
  tenantName: string;
  logoUrl: string | null;
}

/** The glyph before a preview: the microphone for a recording only (UI-D-866, UI-D-853). */
function previewLeading(kind: PreviewKind) {
  return kind === 'voice' ? <Mic aria-hidden size={14} className="shrink-0" /> : undefined;
}

/**
 * The support row's avatar slot (UI-D-862): the tenant logo contained in a 40px neutral disc, or the `Headset`
 * glyph on `bg-bg-tertiary` when the tenant has none. Decorative: the row's name carries the words.
 */
function SupportAvatar({ tenantName, logoUrl }: { tenantName: string; logoUrl: string | null }) {
  return (
    <span
      aria-hidden
      data-support-avatar
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-tertiary text-text-secondary"
    >
      {logoUrl ? (
        <TenantLogo
          logoUrl={logoUrl}
          displayName={tenantName}
          size="thread"
          hideOnError
          className="h-6 max-w-7"
        />
      ) : (
        <Headset aria-hidden size={20} />
      )}
    </span>
  );
}

function SupportRow({
  row,
  tenantName,
  logoUrl,
}: {
  row: SupportRowView;
  tenantName: string;
  logoUrl: string | null;
}) {
  return (
    <InboxRow
      href={row.href}
      avatar={null}
      avatarSlot={<SupportAvatar tenantName={tenantName} logoUrl={logoUrl} />}
      name={row.name}
      preview={row.preview}
      previewMuted={row.idle}
      previewLeading={previewLeading(row.previewKind)}
      time=""
      awaiting={row.unread}
      state="active"
      label={row.label}
      unread={row.unread ? <Badge count={1} variant="dot" /> : undefined}
    />
  );
}

function DirectRow({ row }: { row: ConversationRowView }) {
  return (
    <InboxRow
      href={row.href}
      avatar={row.avatar}
      name={row.name}
      preview={row.preview}
      previewLeading={previewLeading(row.previewKind)}
      time={row.time}
      awaiting={row.unread !== null}
      state={row.removed ? 'removed' : 'active'}
      label={row.label}
      unread={row.unread ? <Badge count={row.unread.count} /> : undefined}
    />
  );
}

/**
 * The Conversas list (CHAT-06, D-719, D-720, D-721, UI-D-862, UI-D-866, UI-D-879) [designed]: the pinned support
 * row first, then the direct conversations newest first, in one `mx-auto w-full max-w-[680px]` column on every
 * breakpoint (no desktop split for members, A-UI-3). It draws EXACTLY what the API answered, finished by the
 * view functions of 11-18: no filter, no flag and no "blocked me" fact is computed here (T-11-03), and every
 * member string is a React text node (T-11-16).
 *
 * Each row is the shipped `InboxRow` without its case lines: ONE link of at least 44px named by its finished
 * label ("{name}, {count} mensagens novas. {preview}", the count clause only when unread). The unread mark is the
 * shipped count `Badge` (`99+`) on a direct row and the dot on the support row (the support semantics stay a
 * flag, D-237). Rows are plain links (the module cannot import `next/link`); a plain left click is intercepted
 * here and becomes a client navigation, a modified click keeps the browser's own behaviour.
 */
export function ConversationsList({ initial, tenantName, logoUrl }: ConversationsListProps) {
  const t = useTranslations('chat');
  const router = useRouter();

  const onRowClick = useCallback(
    (event: MouseEvent<HTMLUListElement>) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest('a[data-inbox-row]');
      const href = anchor?.getAttribute('href');
      if (!href) return;
      event.preventDefault();
      router.push(href);
    },
    [router],
  );

  const support = initial?.support;
  const rows = initial?.rows ?? [];

  return (
    <div data-conversations className="mx-auto w-full max-w-[680px] pb-6">
      {/* The anchors inside are the interactive elements; this only turns their click into a client
          navigation (Enter on a focused row fires the same click). */}
      {/* Tailwind's preflight sets `list-style: none` on every `ul` and WebKit then drops the list semantics, so
          the explicit role restores "list of N items" (UI-D-862, UI-D-879). */}
      {/* biome-ignore lint/a11y/noRedundantRoles: not redundant under preflight, see the note above. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation of the child links bubbles here. */}
      <ul role="list" aria-label={t('conversations.region')} onClick={onRowClick}>
        {support ? (
          <li>
            <SupportRow row={support} tenantName={tenantName} logoUrl={logoUrl} />
          </li>
        ) : null}
        {rows.map((row) => (
          <li key={row.conversationId}>
            <DirectRow row={row} />
          </li>
        ))}
      </ul>
    </div>
  );
}
