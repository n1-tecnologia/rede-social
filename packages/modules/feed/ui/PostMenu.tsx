'use client';

import { BottomSheet, ConfirmDialog } from '@rede-social/ui';
import { Ban, Flag, Link2, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { MenuRow } from './MenuRow';
import type { PostShareTarget } from './PostCard';

/**
 * The post's "…" menu (UI-SPEC E03/populated) on the SHIPPED `BottomSheet` — the same sheet the
 * comment surface uses, at the same geometry (UI-D-18), because a second overlay primitive is the
 * drift `@rede-social/ui` exists to prevent.
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
  /**
   * 09-09 (UI-D-495): the body when the author deletes a MEMBER post - it leaves Explorar, not "o
   * feed". The title and the buttons are the same four-string set as an administrator's delete.
   */
  deleteBodyMember: string;
  deleteConfirm: string;
  deleteCancel: string;
  /**
   * 09-09 (D-475, UI-D-497): the moderator's removal row and its five FIXED strings. The dialog
   * says nothing about the author being told, because nobody is, and quotes no member content.
   */
  remove: string;
  removeTitle: string;
  removeBody: string;
  removeConfirm: string;
  removeCancel: string;
  /**
   * 11-20 (D-733, UI-D-632): "Denunciar publicação" and "Bloquear {nome}" (the placeholder still in it; the
   * menu fills in the author's name). OPTIONAL on purpose: a host that predates them draws neither row.
   */
  report?: string;
  block?: string;
};

/** Which delete a confirmation is for: the author's own, or a moderator's removal of a member post. */
export type PostDeleteVariant = 'removal';

/** Which post the menu is open on, and everything the row set depends on. */
export type PostMenuTarget = {
  postId: string;
  /** `https://{primaryHost}/post/{id}`, or null where the server could not compose one. */
  shareUrl: string | null;
  /** "I may edit and remove this one" — the API's own answer, copied through (never recomputed). */
  canManage: boolean;
  /** `/post/{id}/editar`, built by the host: the module knows no route table (MOD-02). */
  editHref: string | null;
  /** The API's statement that the viewer may remove this member post as a moderator (D-475). */
  removal?: 'moderation';
  /**
   * True for a member post (`audience` `'followers'` or `'community'`, never an organization post): the
   * author's delete uses the member body.
   */
  memberPost?: boolean;
  /**
   * 11-20 (D-733, UI-D-632): the API's riders, copied through and never derived from a role. `canReport`: the
   * viewer did not write the post. `canBlock`: not their own AND the author is a member AND the viewer is a
   * member (staff are offered Denunciar and never Bloquear, A-11-ROLE). Absent reads as false.
   */
  canReport?: boolean;
  canBlock?: boolean;
  /** The author's display name, for the block row, and their membership id for the block call. */
  authorName?: string;
  authorMembershipId?: string;
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
   *
   * The second argument is `'removal'` for a moderator's removal and absent for the author's own
   * delete: the SAME route and the SAME action, told apart only so the host can toast the right
   * sentence (09-09).
   */
  onDelete?: (postId: string, variant?: PostDeleteVariant) => Promise<void>;
  labels: PostMenuLabels;
  /**
   * 11-20: the host's reaction to the two new rows. The menu closes first and hands the TARGET over: the
   * report sheet and the block dialog are the host's (one implementation for every subject), never the
   * module's. A row is drawn only when its rider, its label and its callback are all present.
   */
  onReport?: (target: PostMenuTarget) => void;
  onBlock?: (target: PostMenuTarget) => void;
};

export function PostMenu({
  open,
  target,
  onClose,
  onSharePost,
  onDelete,
  labels,
  onReport,
  onBlock,
}: PostMenuProps) {
  /**
   * Which confirmation is up. `mode` is kept after the dialog closes on purpose: the dialog's exit
   * animation would otherwise flip to the other wording for a frame once the target is gone.
   */
  const [confirm, setConfirm] = useState<{
    open: boolean;
    mode: 'delete' | 'deleteMember' | 'remove';
  }>({ open: false, mode: 'delete' });

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
      await onDelete(postId, confirm.mode === 'remove' ? 'removal' : undefined);
    } finally {
      // The sheet closes on BOTH outcomes: the dialog's own `finally` closes it either way, and a
      // sheet left standing behind a dismissed failure dialog would be a dead layer over the feed.
      onClose();
    }
  }, [onDelete, postId, onClose, confirm.mode]);

  const canManage = target?.canManage === true;
  // 11-20 (D-733): the two safety rows, from the API's riders as DATA. `Bloquear` also needs the author's
  // name (the row names the person) and `Denunciar` the label; neither is ever drawn for a host without
  // the callback, so a surface that has not wired the sheet shows no dead row.
  const reportRow =
    target?.canReport === true && onReport !== undefined && labels.report !== undefined
      ? { label: labels.report, run: onReport }
      : null;
  const blockRow =
    target?.canBlock === true &&
    onBlock !== undefined &&
    labels.block !== undefined &&
    typeof target.authorName === 'string' &&
    target.authorName !== ''
      ? { label: labels.block.replace('{nome}', target.authorName), run: onBlock }
      : null;
  const safety = (run: (target: PostMenuTarget) => void) => () => {
    if (!target) return;
    onClose();
    run(target);
  };
  // D-475: a moderator's row, drawn from the API's `removal` and only where the author's own
  // controls are not (an author who also moderates keeps the author's set).
  const canRemove = !canManage && target?.removal === 'moderation';

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

          {reportRow ? (
            <MenuRow icon={Flag} label={reportRow.label} onClick={safety(reportRow.run)} />
          ) : null}

          {blockRow ? (
            <MenuRow icon={Ban} label={blockRow.label} onClick={safety(blockRow.run)} />
          ) : null}

          {canManage && onDelete ? (
            <MenuRow
              icon={Trash2}
              label={labels.delete}
              destructive
              onClick={() =>
                setConfirm({ open: true, mode: target?.memberPost ? 'deleteMember' : 'delete' })
              }
            />
          ) : null}

          {canRemove && onDelete ? (
            <MenuRow
              icon={Trash2}
              label={labels.remove}
              destructive
              onClick={() => setConfirm({ open: true, mode: 'remove' })}
            />
          ) : null}
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={confirm.open}
        title={confirm.mode === 'remove' ? labels.removeTitle : labels.deleteTitle}
        body={
          confirm.mode === 'remove'
            ? labels.removeBody
            : confirm.mode === 'deleteMember'
              ? labels.deleteBodyMember
              : labels.deleteBody
        }
        icon={Trash2}
        tone="danger"
        confirmLabel={confirm.mode === 'remove' ? labels.removeConfirm : labels.deleteConfirm}
        cancelLabel={confirm.mode === 'remove' ? labels.removeCancel : labels.deleteCancel}
        onConfirm={confirmDelete}
        onClose={() => setConfirm((previous) => ({ ...previous, open: false }))}
        onError={(error) => console.error('feed.post.delete_failed', { error: String(error) })}
      />
    </>
  );
}
