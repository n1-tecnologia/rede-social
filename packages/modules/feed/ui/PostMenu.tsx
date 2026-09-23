'use client';

import { BottomSheet, ConfirmDialog } from '@tria/ui';
import { Link2, type LucideIcon, Pencil, Trash2 } from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';
import type { PostShareTarget } from './PostCard';

/**
 * The post's "…" menu (UI-SPEC E03/populated) on the SHIPPED `BottomSheet` — the same sheet the
 * comment surface uses, at the same geometry (UI-D-18), because a second overlay primitive is the
 * drift `@tria/ui` exists to prevent.
 *
 * **Two variants, one component, driven by DATA and never by a role.** `canManage` rides each post
 * from the API (the author predicate the write routes enforce), so the author/admin variant — edit,
 * copy link, delete — and the member variant — copy link alone — are the same render with a
 * different row set. Nothing here compares a role, and nothing here decides whether the delete will
 * succeed: the API's own `author_user_id` predicate does, and a client-side guess that disagreed
 * would either hide a legitimate control or offer one that always 404s (the `canDelete` rule 04-07
 * set for comments, restated for posts).
 *
 * **"Copiar link" and the action row's share control are ONE handler.** `onSharePost` is the very
 * same `PostShareTarget`-taking function `PostCard` raises from its `Send` glyph, and the url
 * travels WITH the event — composed on the server from the tenant's verified primary host (T-04-51)
 * — so the two entry points cannot resolve to different links. A post with no share url renders no
 * copy row at all rather than a control that would have nothing to copy.
 *
 * **The destructive confirmation quotes NOTHING** (T-04-58). All four of its strings are fixed
 * catalog values; the caption, the author's name and every filename stay out of it. A dialog that
 * interpolated member content would be both an overflow hazard in a 300px panel and a content path
 * that has no reason to exist.
 */
export type PostMenuLabels = {
  /** "Editar publicação" — rendered only for the author/admin variant. */
  edit: string;
  /** "Copiar link" — the row that reuses the action row's share handler. */
  copyLink: string;
  /** "Excluir publicação", destructive. */
  delete: string;
  /** The four FIXED strings of the confirmation. None of them interpolates anything. */
  deleteTitle: string;
  deleteBody: string;
  deleteConfirm: string;
  deleteCancel: string;
};

/** Which post the menu is open on, and everything the row set depends on. */
export type PostMenuTarget = {
  postId: string;
  /** `https://{primaryHost}/post/{id}`, or null where the server could not compose one. */
  shareUrl: string | null;
  /** "I may edit and remove this one" — the API's own answer, copied through (never recomputed). */
  canManage: boolean;
  /** `/post/{id}/editar`, built by the host: the module knows no route table (MOD-02). */
  editHref: string | null;
};

export type PostMenuProps = {
  open: boolean;
  /** Null while the sheet is closed; the sheet stays mounted so its exit animation can play. */
  target: PostMenuTarget | null;
  onClose: () => void;
  /** The SAME handler `PostCard`'s share control raises — see the docblock. */
  onSharePost?: (share: PostShareTarget) => void;
  /**
   * Soft-deletes the post. It must REJECT on refusal: the confirmation's own `onError` is what the
   * host hangs the generic error toast on, and a promise that resolved on failure would close the
   * dialog with a success the server never gave.
   */
  onDelete?: (postId: string) => Promise<void>;
  labels: PostMenuLabels;
};

/** One 44px-minimum sheet row. `destructive` tints the label with the danger token, never a hex. */
function MenuRow({
  icon: Icon,
  label,
  destructive,
  onClick,
  href,
}: {
  icon: LucideIcon;
  label: string;
  destructive?: boolean;
  onClick?: () => void;
  href?: string;
}): ReactNode {
  const shape = [
    'flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold',
    'transition-colors hover:bg-bg-hover active:bg-bg-tertiary',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset',
    destructive ? 'text-danger' : 'text-text',
  ].join(' ');

  // A plain `<a>` rather than `next/link`: a module package must not depend on the web framework
  // (MOD-02), and the host app is free to intercept the navigation.
  if (href !== undefined) {
    return (
      <a href={href} className={shape}>
        <Icon aria-hidden size={20} className="shrink-0" />
        {label}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={shape}>
      <Icon aria-hidden size={20} className="shrink-0" />
      {label}
    </button>
  );
}

export function PostMenu({ open, target, onClose, onSharePost, onDelete, labels }: PostMenuProps) {
  const [confirming, setConfirming] = useState(false);

  const shareUrl = target?.shareUrl ?? null;
  const postId = target?.postId ?? null;

  const copyLink = useCallback(() => {
    if (onSharePost && postId && shareUrl) onSharePost({ postId, url: shareUrl });
    onClose();
  }, [onSharePost, postId, shareUrl, onClose]);

  /**
   * The dialog owns the pending state: it disables both footer buttons, spins the confirm label with
   * `aria-busy`, blocks backdrop and Escape dismissal while in flight, and closes when the action
   * settles (UI-SPEC E18/loading). A rejection reaches `onError`, which is the host's generic toast.
   */
  const confirmDelete = useCallback(async () => {
    if (!onDelete || !postId) return;
    try {
      await onDelete(postId);
    } finally {
      // The sheet closes on BOTH outcomes: the dialog's own `finally` closes it either way, and a
      // sheet left standing behind a dismissed failure dialog would be a dead layer over the feed.
      onClose();
    }
  }, [onDelete, postId, onClose]);

  const canManage = target?.canManage === true;

  return (
    <>
      <BottomSheet open={open} onClose={onClose}>
        <div className="flex flex-col gap-1">
          {canManage && target?.editHref ? (
            <MenuRow icon={Pencil} label={labels.edit} href={target.editHref} />
          ) : null}

          {shareUrl && onSharePost ? (
            <MenuRow icon={Link2} label={labels.copyLink} onClick={copyLink} />
          ) : null}

          {canManage && onDelete ? (
            <MenuRow
              icon={Trash2}
              label={labels.delete}
              destructive
              onClick={() => setConfirming(true)}
            />
          ) : null}
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={confirming}
        title={labels.deleteTitle}
        body={labels.deleteBody}
        icon={Trash2}
        tone="danger"
        confirmLabel={labels.deleteConfirm}
        cancelLabel={labels.deleteCancel}
        onConfirm={confirmDelete}
        onClose={() => setConfirming(false)}
        onError={(error) => console.error('feed.post.delete_failed', { error: String(error) })}
      />
    </>
  );
}
