'use client';

import { Button, ConfirmDialog, cn, Skeleton, useToast } from '@rede-social/ui';
import { Trash2 } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { CommentInput, type ReplyTarget } from './CommentInput';
import { CommentItem, type CommentItemLabels, type CommentView, removalOf } from './CommentItem';
import { type CountTemplates, formatCountLabel } from './meta';

/**
 * THE comment list (D-59, D-82) — ONE implementation, THREE containers.
 *
 * `CommentSheet` wraps it for the feed, `/post/[id]` renders it inline, and 05-07's story viewer
 * renders it in the `flat` variant inside the same sheet. The only difference between them is
 * `variant`. A second renderer for a second surface is the thing this component exists to prevent:
 * two copies would drift on ordering, on paging, on whether the delete control is offered, and the
 * divergence would surface as "it behaves differently in the sheet".
 *
 * **What `flat` changes, and why it is a VALUE on the existing prop rather than a component.** A
 * story's comments cannot be replied to and cannot be liked — not by policy but by construction:
 * `feed_comments_parent_fk` and `feed_likes_comment_fk` make both rows unrepresentable in Postgres
 * (05-07). So the flat variant draws no reply control, no replies toggle and no per-comment like,
 * and it APPENDS a new root rather than prepending one, because a flat conversation runs forward in
 * time (D-83) while a post's roots are a ranking of threads (D-62). Everything else — the empty
 * copy, the two error branches, the optimistic reconciliation, the removed-author row, the composer
 * — is identical, which is the whole point.
 *
 * The UI's silence is the LEAST important of the three layers. It exists so a member is never
 * invited into a refusal, not as the enforcement.
 *
 * **Container-agnostic and copy-free.** It reads no catalog, formats no date and resolves no URL —
 * every string arrives as a prop and every row arrives already mapped (PWA-03, MOD-02). The one
 * clock it touches is `new Date()` inside the SUBMIT handler, for the row the member just wrote;
 * that is an event, not a render, so UI-D-14's hydration rule is untouched.
 *
 * **Every callback prop is a SERVER ACTION or a client-side handler — never a plain function
 * smuggled across the RSC boundary.** The optimistic row is therefore built from DATA the host
 * passes (`viewer`, `nowLabel`), not from a builder function: a server component may hand a client
 * component values and server actions, and nothing else.
 *
 * **Replies load per root, on demand** (D-60). Rendering N roots issues ZERO reply requests; each
 * expansion issues exactly one bounded request for THAT root, so a comment page's query count stays
 * flat in the number of threads on it (criterion 4). A root with `replyCount === 0` draws neither
 * the hairline rule nor the toggle.
 *
 * **The error branch and the empty branch are mutually exclusive by construction** (UI-D-22,
 * T-04-46). The body below is a single if/else-if chain: `loading` → `listError` → `empty` → rows.
 * There is no path on which a failed load reaches the empty copy, because reaching it would mean
 * telling a member that a post they know has comments has none — a false statement with no recovery
 * affordance. A failed load renders an inline error plus a retry WHERE THE ROWS WOULD BE, and the
 * composer stays usable throughout.
 *
 * **Optimism is never left standing.** A new comment appears immediately and is RECONCILED against
 * the server's row on response; on failure it is removed, the text returns to the field and the
 * inline error renders (T-04-48). The list never shows a comment the server does not have.
 *
 * **Counts are server-owned.** Every like count on every row, and the `onCountChange` delta the host
 * moves the card's meta count with, come from the API's trigger-maintained values. Nothing here
 * derives a count by summing the rows it happens to be holding.
 */

/** What a comment/replies page action answers. A refusal and a rejection are the same outcome. */
export type CommentPageOutcome =
  | { ok: true; items: CommentView[]; nextCursor: string | null }
  | { ok: false };

/**
 * What a create action answers: the server's own row, or a refusal the field recovers from.
 *
 * `code` is a CATALOG KEY the host already chose, never the API's raw machine code (T-04-42) — the
 * list picks which of its two error labels to render from it and nothing server-controlled reaches
 * the DOM. `reply_depth_exceeded` earns its own sentence because it is the one refusal a member can
 * act on: they replied to a reply, and the answer is to reply to the root instead.
 */
export type CommentCreateOutcome =
  | { ok: true; comment: CommentView }
  | { ok: false; code?: 'generic' | 'reply_depth_exceeded' | 'story_comment_no_reply' };

/**
 * What a delete action answers (08-03, UI-D-276). `gone` is the API's bare 404: the comment was
 * already removed (by its author, a moderator, or a cascade), so the row leaves the list anyway and
 * the race toast explains why. Any other refusal is `generic` (or no code): the row STAYS.
 */
export type CommentDeleteOutcome = { ok: boolean; code?: 'gone' | 'generic' };

/** What a comment like/unlike answers — the authoritative pair, read back in the writing txn. */
export type CommentLikeOutcome = { ok: true; liked: boolean; likeCount: number } | { ok: false };

/** The viewer, for the optimistic row only. The server's reconciled row replaces all of it. */
export type CommentViewer = {
  displayName: string;
  /** `/membros/{membershipId}` (D-52). */
  profileHref: string | null;
  avatarUrl: string | null;
};

export type CommentsListLabels = {
  /** Accessible name of the list region. */
  region: string;
  /** UI-SPEC E10/empty: the centred single line, shown ONLY when the page really is empty. */
  emptyLabel: string;
  /** UI-D-22: the comment list itself could not be read. */
  errorLabel: string;
  /** UI-D-22: one root's replies could not be read; the thread does NOT collapse. */
  errorRepliesLabel: string;
  /** "Tentar novamente", shared by both retries. */
  retryLabel: string;
  /** Shown above the field when a submit is refused; the draft stays put. */
  submitErrorLabel: string;
  /** The one refusal with its own sentence: the member replied to a reply (D-60). */
  replyDepthErrorLabel: string;
  /** STORY-05's own sentence: the member tried to reply to a STORY comment (05-07). */
  storyNoReplyErrorLabel: string;
  /** The root list's own paging control. */
  loadMoreLabel: string;
  /** One root's replies paging control, beneath the expanded thread. */
  loadMoreRepliesLabel: string;
  /** "Ver {count} resposta(s)" / "Ocultar {count} resposta(s)" — ICU plurals from the host. */
  showReplies: CountTemplates;
  hideReplies: CountTemplates;
  /** "Respondendo a {name}" with `{name}` still in it: the list interpolates the target. */
  replyChip: string;
  replyChipDismiss: string;
  placeholder: string;
  submitLabel: string;
  viewerLabel: string;
  /** UI-D-14: what a comment the member JUST wrote shows instead of a relative time. */
  nowLabel: string;
  /** The confirmation the own-comment delete opens (D-61). */
  deleteTitle: string;
  deleteBody: string;
  /**
   * 08-03 (D-334, UI-D-276): the own dialog's body for a ROOT with live replies — "Ele e as respostas
   * saem da conversa…" (`feed.comments.delete.bodyWithReplies`). The cascade applies to authors too.
   * Absent means the host predates it, and `deleteBody` is used.
   */
  deleteBodyWithReplies?: string;
  deleteConfirm: string;
  deleteCancel: string;
  /**
   * 08-01 (UI-D-276): the MODERATION dialog a holder of `moderation.manage` sees on someone else's
   * comment — "Remover comentário?", a body naming the author (`{author}` still in it; the list
   * fills it in) with and without replies, "Remover" / "Cancelar" — and the "Comentário removido."
   * toast. Absent means the host predates moderation, and the own dialog is used.
   */
  moderation?: CommentModerationLabels;
  item: CommentItemLabels;
};

export type CommentModerationLabels = {
  title: string;
  /** "O comentário de {author} sai da conversa…" — `{author}` filled by the list. */
  body: string;
  /** The same sentence for a root with live replies (D-334: they leave with it). */
  bodyWithReplies: string;
  confirm: string;
  cancel: string;
  /** The success toast after a moderator's removal. */
  removedToast: string;
  /**
   * 08-03 (UI-D-276): the two failure toasts of ANY removal, own or moderation — a refusal keeps the
   * row ("Não foi possível remover…"), a 404 race removes it ("Este comentário já tinha sido
   * removido."). Absent means the host predates them, and a failure stays silent (the row stays).
   */
  failedToast?: string;
  goneToast?: string;
};

export type CommentsListProps = {
  /**
   * The thing being commented ON — a post id for the feed's two containers, a STORY id for the
   * flat variant (05-07). It is opaque to this component: it is handed straight back to the four
   * handlers the host supplied, and nothing here reads it.
   */
  targetId: string;
  /**
   * The page the SERVER rendered, when there is one (the post page). `undefined` means "nothing is
   * seeded" — the sheet, which fetches page 1 on mount behind the skeletons.
   */
  initialItems?: CommentView[];
  initialCursor?: string | null;
  /** `true` when the server tried to read page 1 and could not (UI-D-22). */
  initialError?: boolean;
  variant?: 'sheet' | 'inline' | 'flat';
  viewer: CommentViewer;
  /** BCP-47 tag from the host: the module formats numbers for it but ships no words (PWA-03). */
  locale: string;
  labels: CommentsListLabels;
  onLoadComments: (targetId: string, cursor?: string) => Promise<CommentPageOutcome>;
  onLoadReplies: (commentId: string, cursor?: string) => Promise<CommentPageOutcome>;
  onCreateComment: (
    targetId: string,
    body: string,
    parentId?: string,
  ) => Promise<CommentCreateOutcome>;
  onDeleteComment: (commentId: string) => Promise<CommentDeleteOutcome>;
  onLikeComment: (commentId: string) => Promise<CommentLikeOutcome>;
  onUnlikeComment: (commentId: string) => Promise<CommentLikeOutcome>;
  /** `+1` / `-1` as the post's comment count moves, so the card's meta row follows the sheet. */
  onCountChange?: (delta: number) => void;
  /**
   * 07-04 (UI-D-254): the ROOT thread a notification tap named (`/post/{id}?comentario=`), rendered
   * FIRST. Its root is filtered out of every page below it by id, so it never repeats however far
   * the member pages; its replies are seeded (expanded when the target is a reply, collapsed but
   * pre-loaded when the target is the root) and `repliesCursor` continues their keyset.
   */
  pinnedThread?: PinnedThread;
  /** The comment to scroll to and tint (UI-D-254); it lies inside `pinnedThread`. */
  highlightCommentId?: string;
};

/** The pinned root thread, already mapped by the host. */
export type PinnedThread = {
  root: CommentView;
  replies: CommentView[];
  repliesCursor: string | null;
};

/** One root's reply thread. Absent from the map until the member first expands that root. */
type ReplyThread = {
  expanded: boolean;
  items: CommentView[];
  cursor: string | null;
  loading: boolean;
  error: boolean;
};

const SKELETON_ROWS = [0, 1, 2];
const REPLY_SKELETON_ROWS = [0, 1];
const EMPTY_THREAD: ReplyThread = {
  expanded: false,
  items: [],
  cursor: null,
  loading: false,
  error: false,
};

/** The geometry of a real row: circle, a name-plus-body line and a meta line. */
function CommentRowSkeleton({ indented = false }: { indented?: boolean }) {
  return (
    <div aria-hidden className={cn('flex gap-3 px-4 py-3', indented && 'pl-14')}>
      <Skeleton variant="circle" className="h-8 w-8" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton variant="text" width="70%" className="h-3.5" />
        <Skeleton variant="text" width="30%" className="h-3" />
      </div>
    </div>
  );
}

/**
 * 08-01 (UI-D-276): a removal toast, as a component that owns `useToast` ONLY while it is mounted —
 * the `PostMedia` rule: the hook throws outside a `ToastProvider`, and a list that never removed
 * anything must not need one. Keyed by the list, so each outcome shows once. The shipped toast is
 * `role="status"` (UI-D-288).
 */
function ListToast({ message, tone }: { message: string; tone: 'success' | 'error' | 'info' }) {
  const toast = useToast();
  useEffect(() => {
    toast.show({ tone, message });
  }, [toast, message, tone]);
  return null;
}

/** Where focus goes after a removal (UI-D-288): a row id, or the composer. */
type FocusTarget = { kind: 'row'; id: string } | { kind: 'input' };

/**
 * Three rows, exported so both containers' loading boundaries have the SAME geometry as the list
 * they stand in for and the swap to content does not shift the sheet.
 */
export function CommentsListSkeleton() {
  return (
    <div aria-busy data-testid="comments-skeleton">
      {SKELETON_ROWS.map((index) => (
        <CommentRowSkeleton key={index} />
      ))}
    </div>
  );
}

export function CommentsList({
  targetId,
  initialItems,
  initialCursor = null,
  initialError = false,
  variant = 'inline',
  viewer,
  locale,
  labels,
  onLoadComments,
  onLoadReplies,
  onCreateComment,
  onDeleteComment,
  onLikeComment,
  onUnlikeComment,
  onCountChange,
  pinnedThread,
  highlightCommentId,
}: CommentsListProps) {
  // D-82. Read once, near the top, because six things below branch on it and a scattered
  // `variant === 'flat'` is how the two lists start becoming two components.
  const flat = variant === 'flat';

  // UI-D-254: the pinned root leads the list and is dropped from every page by id, so a thread the
  // server also returns on page 1 (or page 8) is never drawn twice.
  const pinnedRoot = flat ? null : (pinnedThread?.root ?? null);
  const withPinned = useCallback(
    (rows: CommentView[]) =>
      pinnedRoot ? [pinnedRoot, ...rows.filter((row) => row.id !== pinnedRoot.id)] : rows,
    [pinnedRoot],
  );
  const withoutPinned = useCallback(
    (rows: CommentView[]) => (pinnedRoot ? rows.filter((row) => row.id !== pinnedRoot.id) : rows),
    [pinnedRoot],
  );

  const [items, setItems] = useState<CommentView[]>(() =>
    initialItems === undefined ? [] : withPinned(initialItems),
  );
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(initialItems === undefined && !initialError);
  const [listError, setListError] = useState(initialError);
  const [loadingMore, setLoadingMore] = useState(false);

  const [threads, setThreads] = useState<Record<string, ReplyThread>>(() =>
    pinnedThread && !flat
      ? {
          [pinnedThread.root.id]: {
            // Expanded exactly when the target is one of the replies (UI-D-254 partial).
            expanded:
              highlightCommentId !== undefined && highlightCommentId !== pinnedThread.root.id,
            items: pinnedThread.replies,
            cursor: pinnedThread.repliesCursor,
            loading: false,
            error: false,
          },
        }
      : {},
  );
  const [replyTarget, setReplyTarget] = useState<{ commentId: string; name: string } | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const [submitError, setSubmitError] = useState<
    'generic' | 'reply_depth_exceeded' | 'story_comment_no_reply' | null
  >(null);
  const [confirming, setConfirming] = useState<CommentView | null>(null);
  // One removal outcome toast at a time; `key` mounts a fresh `ListToast` for each outcome.
  const [removalToast, setRemovalToast] = useState<{
    key: number;
    message: string;
    tone: 'success' | 'error' | 'info';
  } | null>(null);
  const [pendingFocus, setPendingFocus] = useState<FocusTarget | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  const raiseToast = useCallback((message: string, tone: 'success' | 'error' | 'info') => {
    setRemovalToast((previous) => ({ key: (previous?.key ?? 0) + 1, message, tone }));
  }, []);

  const patchThread = useCallback((rootId: string, patch: Partial<ReplyThread>) => {
    setThreads((previous) => ({
      ...previous,
      [rootId]: { ...(previous[rootId] ?? EMPTY_THREAD), ...patch },
    }));
  }, []);

  /** Page 1. Shared by the mount fetch and the UI-D-22 retry, so the two cannot diverge. */
  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setListError(false);
    let page: CommentPageOutcome = { ok: false };
    try {
      page = await onLoadComments(targetId);
    } catch (error) {
      console.error('feed.comments.load_failed', { error: String(error) });
    }
    setLoading(false);
    if (!page.ok) {
      setListError(true);
      return;
    }
    setItems(withPinned(page.items));
    setCursor(page.nextCursor);
  }, [onLoadComments, targetId, withPinned]);

  // Fetch page 1 exactly once when nothing was seeded (the sheet). A seeded list never runs this.
  const fetched = useRef(false);
  useEffect(() => {
    if (initialItems !== undefined || initialError || fetched.current) return;
    fetched.current = true;
    void loadFirstPage();
  }, [initialItems, initialError, loadFirstPage]);

  /** APPEND: every row already on screen keeps its order and its DOM position. */
  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    const from = cursor;
    setLoadingMore(true);
    let page: CommentPageOutcome = { ok: false };
    try {
      page = await onLoadComments(targetId, from);
    } catch (error) {
      console.error('feed.comments.load_more_failed', { error: String(error) });
    }
    setLoadingMore(false);
    if (!page.ok) {
      setListError(true);
      return;
    }
    setItems((previous) => [...previous, ...withoutPinned(page.items)]);
    setCursor(page.nextCursor);
  }, [cursor, loadingMore, onLoadComments, targetId, withoutPinned]);

  /** Fetch (or re-fetch) ONE root's first page of replies. The retry and the first tap share it. */
  const fetchReplies = useCallback(
    async (rootId: string) => {
      patchThread(rootId, { expanded: true, loading: true, error: false });
      let page: CommentPageOutcome = { ok: false };
      try {
        page = await onLoadReplies(rootId);
      } catch (error) {
        console.error('feed.replies.load_failed', { error: String(error) });
      }
      // UI-D-22: a failed replies query renders its retry UNDER the toggle and leaves the thread
      // EXPANDED. Collapsing it here would hide the very control the member needs to try again.
      if (!page.ok) {
        patchThread(rootId, { expanded: true, loading: false, error: true });
        return;
      }
      patchThread(rootId, {
        expanded: true,
        items: page.items,
        cursor: page.nextCursor,
        loading: false,
        error: false,
      });
    },
    [onLoadReplies, patchThread],
  );

  /**
   * Expand or collapse ONE root (D-60). The first expansion fetches that root's own page; a later
   * collapse keeps what was loaded, so re-expanding costs no request at all.
   */
  const toggleThread = useCallback(
    (comment: CommentView) => {
      const existing = threads[comment.id];
      if (existing?.expanded) {
        patchThread(comment.id, { expanded: false });
        return;
      }
      if (existing && existing.items.length > 0 && !existing.error) {
        patchThread(comment.id, { expanded: true });
        return;
      }
      void fetchReplies(comment.id);
    },
    [fetchReplies, patchThread, threads],
  );

  /** One more page of a root's replies, appended oldest-first (D-62). */
  const loadMoreReplies = useCallback(
    async (rootId: string) => {
      const thread = threads[rootId];
      if (!thread?.cursor || thread.loading) return;
      const from = thread.cursor;
      patchThread(rootId, { loading: true, error: false });

      let page: CommentPageOutcome = { ok: false };
      try {
        page = await onLoadReplies(rootId, from);
      } catch (error) {
        console.error('feed.replies.load_more_failed', { error: String(error) });
      }
      if (!page.ok) {
        patchThread(rootId, { loading: false, error: true });
        return;
      }
      setThreads((previous) => {
        const current = previous[rootId] ?? EMPTY_THREAD;
        // A pinned thread may already hold a reply from beyond its first page (the highlighted
        // target, UI-D-254): paging on must not draw it a second time.
        const held = new Set(current.items.map((row) => row.id));
        return {
          ...previous,
          [rootId]: {
            ...current,
            items: [...current.items, ...page.items.filter((row) => !held.has(row.id))],
            cursor: page.nextCursor,
            loading: false,
            error: false,
          },
        };
      });
    },
    [onLoadReplies, patchThread, threads],
  );

  /**
   * Submit. Optimistic insert → server row → reconcile, or → remove and hand the text back.
   *
   * A root is PREPENDED (roots are newest-first, D-62) and a reply is APPENDED to its thread
   * (replies are oldest-first). Both land where the server's own ordering would put them, so the
   * reconciliation never moves a row the member is already looking at.
   */
  const submit = useCallback(
    async (body: string): Promise<boolean> => {
      const parentId = replyTarget?.commentId;
      // A clock in an EVENT handler, not in render — UI-D-14's hydration rule is about render.
      const nowIso = new Date().toISOString();
      const optimistic: CommentView = {
        id: `optimistic-${nowIso}-${Math.random().toString(36).slice(2)}`,
        body,
        author: {
          displayName: viewer.displayName,
          profileHref: viewer.profileHref,
          avatarUrl: viewer.avatarUrl,
        },
        authorRemoved: false,
        createdAtIso: nowIso,
        createdAtRelative: labels.nowLabel,
        createdAtAbsolute: labels.nowLabel,
        likeCount: 0,
        viewerLiked: false,
        replyCount: 0,
        isReply: parentId !== undefined,
        canDelete: false,
        pending: true,
      };
      setSubmitError(null);

      if (parentId) {
        setThreads((previous) => {
          const current = previous[parentId] ?? EMPTY_THREAD;
          return {
            ...previous,
            [parentId]: { ...current, expanded: true, items: [...current.items, optimistic] },
          };
        });
        setItems((previous) =>
          previous.map((row) =>
            row.id === parentId ? { ...row, replyCount: row.replyCount + 1 } : row,
          ),
        );
      } else {
        // D-83 vs D-62: the flat list runs oldest-first so a new comment lands at the BOTTOM; the
        // post's roots run newest-first so it lands at the top. Both put the row where the SERVER's
        // own ordering would, so the reconciliation never moves a row the member is looking at.
        setItems((previous) => (flat ? [...previous, optimistic] : [optimistic, ...previous]));
      }

      let outcome: CommentCreateOutcome = { ok: false };
      try {
        outcome = await onCreateComment(targetId, body, parentId);
      } catch (error) {
        console.error('feed.comment.create_failed', { error: String(error) });
      }

      if (!outcome.ok) {
        // The optimistic row is REMOVED, not left standing (T-04-48): a comment the server does not
        // have must not sit in the list looking as though it does.
        if (parentId) {
          setThreads((previous) => {
            const current = previous[parentId];
            if (!current) return previous;
            return {
              ...previous,
              [parentId]: {
                ...current,
                items: current.items.filter((row) => row.id !== optimistic.id),
              },
            };
          });
          setItems((previous) =>
            previous.map((row) =>
              row.id === parentId ? { ...row, replyCount: Math.max(0, row.replyCount - 1) } : row,
            ),
          );
        } else {
          setItems((previous) => previous.filter((row) => row.id !== optimistic.id));
        }
        setSubmitError(
          outcome.code === 'reply_depth_exceeded' || outcome.code === 'story_comment_no_reply'
            ? outcome.code
            : 'generic',
        );
        return false;
      }

      const created = outcome.comment;
      if (parentId) {
        setThreads((previous) => {
          const current = previous[parentId];
          if (!current) return previous;
          return {
            ...previous,
            [parentId]: {
              ...current,
              items: current.items.map((row) => (row.id === optimistic.id ? created : row)),
            },
          };
        });
      } else {
        setItems((previous) => previous.map((row) => (row.id === optimistic.id ? created : row)));
      }
      setReplyTarget(null);
      onCountChange?.(1);
      return true;
    },
    [flat, labels.nowLabel, onCountChange, onCreateComment, replyTarget, targetId, viewer],
  );

  /**
   * The like toggle for one row, optimistic in exactly the way the card's is (04-06): flip now,
   * replace with the server's authoritative pair on response, revert on refusal. It patches BOTH
   * lists because a row's identity is its id — a reply and a root take the identical path.
   */
  const toggleLike = useCallback(
    async (comment: CommentView) => {
      const apply = (patch: Partial<CommentView>) => {
        const patchRow = (row: CommentView) => (row.id === comment.id ? { ...row, ...patch } : row);
        setItems((previous) => previous.map(patchRow));
        setThreads((previous) => {
          const next: Record<string, ReplyThread> = {};
          for (const [rootId, thread] of Object.entries(previous)) {
            next[rootId] = { ...thread, items: thread.items.map(patchRow) };
          }
          return next;
        });
      };

      const nextLiked = !comment.viewerLiked;
      apply({
        viewerLiked: nextLiked,
        likeCount: Math.max(0, comment.likeCount + (nextLiked ? 1 : -1)),
      });

      let outcome: CommentLikeOutcome = { ok: false };
      try {
        outcome = nextLiked ? await onLikeComment(comment.id) : await onUnlikeComment(comment.id);
      } catch (error) {
        console.error('feed.comment.like_failed', { error: String(error) });
      }
      apply(
        outcome.ok
          ? { viewerLiked: outcome.liked, likeCount: outcome.likeCount }
          : { viewerLiked: comment.viewerLiked, likeCount: comment.likeCount },
      );
    },
    [onLikeComment, onUnlikeComment],
  );

  /**
   * D-61, widened by 08-01 (D-334) and finished by 08-03 (UI-D-276, UI-D-288). The row leaves the
   * list only once the SERVER has answered — never optimistically:
   *
   * - **Confirmed:** a ROOT leaves together with its loaded replies (the server soft-deleted them in
   *   the same statement), and the visible count drops by 1 + its SERVER reply count — the number
   *   the trigger just subtracted, not the replies that happen to be loaded. A moderator's removal
   *   raises "Comentário removido."; an author's own keeps its shipped silence.
   * - **404 race (`gone`):** someone removed it first. The row leaves exactly as above and the race
   *   toast says so, rather than leaving a ghost the member would tap again.
   * - **Any other failure:** the row STAYS where it is and the failure toast fires.
   *
   * Focus then moves to the next comment row (the previous one when it was the last), or to the
   * composer when none is left (UI-D-288), so a keyboard moderator never lands on `<body>`.
   */
  const confirmDelete = useCallback(async () => {
    const target = confirming;
    if (!target) return;
    let outcome: CommentDeleteOutcome = { ok: false };
    try {
      outcome = await onDeleteComment(target.id);
    } catch (error) {
      console.error('feed.comment.delete_failed', { error: String(error) });
    }
    const gone = !outcome.ok && outcome.code === 'gone';
    // A refusal keeps the comment exactly where it is rather than removing it from the member's
    // view while it still exists for everyone else.
    if (!outcome.ok && !gone) {
      if (labels.moderation?.failedToast) raiseToast(labels.moderation.failedToast, 'error');
      return;
    }

    // UI-D-288: decide where focus goes BEFORE the rows move.
    let focusTarget: FocusTarget = { kind: 'input' };
    if (target.isReply) {
      const parentId = Object.entries(threads).find(([, thread]) =>
        thread.items.some((row) => row.id === target.id),
      )?.[0];
      const siblings = parentId ? (threads[parentId]?.items ?? []) : [];
      const at = siblings.findIndex((row) => row.id === target.id);
      const neighbour = siblings[at + 1] ?? siblings[at - 1];
      focusTarget = neighbour
        ? { kind: 'row', id: neighbour.id }
        : parentId
          ? { kind: 'row', id: parentId }
          : { kind: 'input' };

      setThreads((previous) => {
        const next: Record<string, ReplyThread> = {};
        for (const [rootId, thread] of Object.entries(previous)) {
          next[rootId] = { ...thread, items: thread.items.filter((row) => row.id !== target.id) };
        }
        return next;
      });
      if (parentId) {
        setItems((previous) =>
          previous.map((row) =>
            row.id === parentId ? { ...row, replyCount: Math.max(0, row.replyCount - 1) } : row,
          ),
        );
      }
      onCountChange?.(-1);
    } else {
      const at = items.findIndex((row) => row.id === target.id);
      const neighbour = items[at + 1] ?? items[at - 1];
      if (neighbour) focusTarget = { kind: 'row', id: neighbour.id };

      setItems((previous) => previous.filter((row) => row.id !== target.id));
      setThreads((previous) => {
        if (!(target.id in previous)) return previous;
        const { [target.id]: _removed, ...rest } = previous;
        return rest;
      });
      onCountChange?.(-(1 + Math.max(0, target.replyCount)));
    }
    setPendingFocus(focusTarget);

    if (gone) {
      if (labels.moderation?.goneToast) raiseToast(labels.moderation.goneToast, 'info');
    } else if (removalOf(target) === 'moderation' && labels.moderation) {
      raiseToast(labels.moderation.removedToast, 'success');
    }
  }, [confirming, items, labels.moderation, onCountChange, onDeleteComment, raiseToast, threads]);

  // UI-D-288: move focus once the removal has rendered AND the dialog has let go of it (its focus
  // trap restores focus to the now-detached trash control, which is a no-op, on the same commit).
  useEffect(() => {
    if (!pendingFocus) return;
    const frame = requestAnimationFrame(() => {
      if (pendingFocus.kind === 'input') {
        setFocusKey((key) => key + 1);
      } else {
        const row = sectionRef.current?.querySelector<HTMLElement>(
          `[data-comment-id="${CSS.escape(pendingFocus.id)}"]`,
        );
        if (row) row.focus({ preventScroll: false });
        else setFocusKey((key) => key + 1);
      }
      setPendingFocus(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingFocus]);

  /** The dialog's copy for the row being confirmed: the moderator's, or the author's own. */
  const moderationDialog =
    confirming !== null && removalOf(confirming) === 'moderation' ? labels.moderation : undefined;
  // D-334: the with-replies wording only for a ROOT that has live replies — a reply never has any.
  const withReplies =
    confirming !== null && !confirming.isReply && Math.max(0, confirming.replyCount) > 0;
  const confirmingAuthor =
    confirming === null
      ? ''
      : confirming.authorRemoved
        ? labels.item.removedAuthor
        : (confirming.author.displayName ?? labels.item.removedAuthor);

  const startReply = useCallback((comment: CommentView) => {
    setReplyTarget({ commentId: comment.id, name: comment.author.displayName ?? '' });
    setFocusKey((key) => key + 1);
  }, []);

  const chip: ReplyTarget | null = replyTarget
    ? {
        commentId: replyTarget.commentId,
        chipLabel: labels.replyChip.replace('{name}', replyTarget.name),
        dismissLabel: labels.replyChipDismiss,
      }
    : null;

  /** The toggle beneath a root's body: a short rule, then the ICU-plural label **[proto]**. */
  const renderToggle = (comment: CommentView): ReactNode => {
    // D-82: a story comment cannot HAVE replies, so the toggle would be an affordance pointing at
    // a row the database refuses to create.
    if (flat) return null;
    // E11/empty: zero replies draws NEITHER the hairline rule NOR the toggle.
    if (comment.replyCount < 1) return null;
    const expanded = Boolean(threads[comment.id]?.expanded);
    const label = formatCountLabel(
      comment.replyCount,
      expanded ? labels.hideReplies : labels.showReplies,
      locale,
    );
    if (!label) return null;

    return (
      <button
        type="button"
        data-replies-toggle
        aria-expanded={expanded}
        onClick={() => toggleThread(comment)}
        className="mt-2 flex items-center gap-2 text-xs font-bold text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <span aria-hidden className="h-px w-6 bg-border" />
        {label}
      </button>
    );
  };

  /**
   * The expanded thread, rendered as a SIBLING of the root's row rather than inside its body: the
   * reply indent is `pl-14` measured from the LIST's own left edge **[proto]**, and nesting it
   * inside the root's already-indented body would compound the two.
   */
  const renderThread = (comment: CommentView): ReactNode => {
    if (flat) return null;
    const thread = threads[comment.id];
    if (!thread?.expanded) return null;

    return (
      <div data-replies-of={comment.id}>
        {thread.loading && thread.items.length === 0
          ? REPLY_SKELETON_ROWS.map((index) => <CommentRowSkeleton key={index} indented />)
          : null}

        {thread.items.map((reply) => (
          <CommentItem
            key={reply.id}
            comment={reply}
            locale={locale}
            labels={labels.item}
            // NO `onReply` — a reply has no reply affordance and no toggle of its own (D-60). The
            // one-level cap is visible here, not merely refused by the database.
            onDelete={removalOf(reply) !== null ? setConfirming : undefined}
            onToggleLike={(row) => void toggleLike(row)}
            highlighted={reply.id === highlightCommentId}
          />
        ))}

        {thread.error ? (
          <div data-replies-error className="flex flex-col items-start gap-2 py-2 pr-4 pl-14">
            <p className="text-sm font-normal text-danger">{labels.errorRepliesLabel}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void (thread.items.length > 0
                  ? loadMoreReplies(comment.id)
                  : fetchReplies(comment.id))
              }
            >
              {labels.retryLabel}
            </Button>
          </div>
        ) : null}

        {!thread.error && thread.cursor ? (
          <div className="py-1 pr-4 pl-14">
            <Button
              variant="ghost"
              size="sm"
              loading={thread.loading}
              onClick={() => void loadMoreReplies(comment.id)}
            >
              {labels.loadMoreRepliesLabel}
            </Button>
          </div>
        ) : null}
      </div>
    );
  };

  /**
   * ONE chain, four outcomes, no overlap. `listError` can never fall through to `emptyLabel`
   * (UI-D-22): a failed load says so and offers a retry, and the empty copy is reachable only when
   * a page really did come back with nothing in it.
   */
  let body: ReactNode;
  if (loading) {
    body = <CommentsListSkeleton />;
  } else if (listError) {
    body = (
      <div data-comments-error className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <p className="text-sm font-normal text-danger">{labels.errorLabel}</p>
        <Button variant="outline" onClick={() => void loadFirstPage()}>
          {labels.retryLabel}
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <p
        data-comments-empty
        className="px-4 py-10 text-center text-sm font-normal text-text-tertiary"
      >
        {labels.emptyLabel}
      </p>
    );
  } else {
    body = (
      <div data-comments-rows>
        {items.map((comment, index) => (
          <div
            key={comment.id}
            // E10/zero-one-many: the separator sits BETWEEN roots — never above the first one.
            className={cn(index > 0 && 'border-t border-border')}
          >
            <CommentItem
              comment={comment}
              locale={locale}
              labels={labels.item}
              // D-82: BOTH handlers are withheld in the flat variant, and withholding them is what
              // removes the controls — `CommentItem` chooses its shell from the handlers it was
              // given, so there is no second branch anywhere about what a comment looks like.
              onReply={flat ? undefined : startReply}
              onDelete={removalOf(comment) !== null ? setConfirming : undefined}
              onToggleLike={flat ? undefined : (row) => void toggleLike(row)}
              highlighted={!flat && comment.id === highlightCommentId}
            >
              {renderToggle(comment)}
            </CommentItem>
            {renderThread(comment)}
          </div>
        ))}

        {cursor ? (
          <div className="px-4 py-2">
            <Button
              variant="ghost"
              size="sm"
              fullWidth
              loading={loadingMore}
              onClick={() => void loadMore()}
            >
              {labels.loadMoreLabel}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section
      ref={sectionRef}
      aria-label={labels.region}
      data-comments-list
      // In a sheet the list fills the primitive's unpadded `scroll="content"` body and shrinks with
      // it: the sheet's HEIGHT is the primitive's cap, never set here (UI-D-18).
      className={cn('flex flex-col', variant !== 'inline' && 'min-h-0 flex-auto')}
    >
      {/* E10/partial: the body and the composer are independent — the composer is rendered OUTSIDE
          the chain above, so a failed or still-loading list never takes the input away. In a sheet
          the rows are the scrollport and the composer is a footer BELOW it (UI-SPEC §Comment
          contract): it never covers the last row, and nothing scrolls underneath it. Inline, the
          page scrolls and this wrapper is a plain block. */}
      <div
        data-comments-scroll={variant !== 'inline' ? '' : undefined}
        className={cn(
          variant !== 'inline' && 'min-h-0 flex-auto overflow-y-auto overscroll-contain',
          // 2026-10-06: a quiet scrollbar, thin and in the handle's ink on a clear track.
          variant !== 'inline' &&
            '[scrollbar-color:var(--color-handle)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-handle [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1',
        )}
      >
        {body}
      </div>

      <CommentInput
        viewerAvatarUrl={viewer.avatarUrl}
        viewerLabel={labels.viewerLabel}
        placeholder={labels.placeholder}
        submitLabel={labels.submitLabel}
        replyTarget={chip}
        onDismissReply={() => setReplyTarget(null)}
        onSubmit={submit}
        errorLabel={
          submitError === null
            ? null
            : submitError === 'reply_depth_exceeded'
              ? labels.replyDepthErrorLabel
              : submitError === 'story_comment_no_reply'
                ? labels.storyNoReplyErrorLabel
                : labels.submitErrorLabel
        }
        onClearError={() => setSubmitError(null)}
        focusKey={focusKey}
        variant={variant}
      />

      <ConfirmDialog
        open={confirming !== null}
        title={moderationDialog ? moderationDialog.title : labels.deleteTitle}
        body={
          moderationDialog
            ? (withReplies ? moderationDialog.bodyWithReplies : moderationDialog.body).replaceAll(
                '{author}',
                confirmingAuthor,
              )
            : withReplies && labels.deleteBodyWithReplies
              ? labels.deleteBodyWithReplies
              : labels.deleteBody
        }
        icon={Trash2}
        tone="danger"
        confirmLabel={moderationDialog ? moderationDialog.confirm : labels.deleteConfirm}
        cancelLabel={moderationDialog ? moderationDialog.cancel : labels.deleteCancel}
        onConfirm={confirmDelete}
        onClose={() => setConfirming(null)}
        onError={(error) => console.error('feed.comment.delete_failed', { error: String(error) })}
      />
      {removalToast ? (
        <ListToast key={removalToast.key} message={removalToast.message} tone={removalToast.tone} />
      ) : null}
    </section>
  );
}
