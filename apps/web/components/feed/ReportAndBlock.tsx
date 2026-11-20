'use client';

import {
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  type ReportReason,
  type ReportSubjectType,
} from '@rede-social/contracts/moderation';
import type {
  CommentsListLabels,
  CommentView,
  PostMenuLabels,
  PostMenuTarget,
} from '@rede-social/module-feed/ui';
import { BottomSheet, Button, ConfirmDialog, Textarea, useToast } from '@rede-social/ui';
import { Ban, CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { reportSubjectView } from '@/lib/reports-view';
import type { blockMember, ReportCode, reportContent } from './safety-actions';

/**
 * The member's report sheet (11-20, MODER-05, D-731, UI-D-871), ONE sheet for every subject: a post, a post
 * comment, a story, a story comment, a community and a direct message (plans 22 to 25 reuse it with their own
 * `subjectType`). Only the TITLE (and a message's one privacy line) changes per subject, and both come from
 * `reportSubjectView` over the `safety` catalog; the intro, the five reasons, the optional note and the button are
 * shared.
 *
 * - **The reason is mandatory, the note is not.** The send button stays disabled until a reason is chosen. A note
 *   left empty (or only spaces) is sent with the note OMITTED (`reportContent` drops it through the contract's
 *   own schema), never as an empty string.
 * - **While the request runs** the button reads "Enviando…", every field is locked and the sheet cannot be
 *   closed (a closed sheet would orphan a pending report), so a double tap sends ONE request.
 * - **How it ends.** Success and `already_reported` close the sheet with a toast and no second toast (the repeat
 *   is the plain success: the same sentence family, nothing about the earlier report). A `404` closes with the
 *   item's unavailable sentence, which never says why (a message of someone else's conversation reads the same).
 *   Any other failure (including the rate limit and a lost session) is the alert block inside the sheet, with
 *   the member's choices kept for the next try.
 * - **Nothing implies the author will be told** (T-11-03): no sentence in this file, nor in the catalog keys it
 *   reads, names a notice to the other party.
 * - **A member's note is React text only** (T-11-16): the textarea is a controlled input, the counter is a number,
 *   and nothing is ever rendered as markup.
 */

/** What the sheet reports on. `voice` only changes a direct message's title and privacy line. */
export type ReportTarget = {
  subjectType: ReportSubjectType;
  subjectId: string;
  voice?: boolean;
};

/**
 * What a host passes to opt a posts surface into Denunciar and Bloquear (D-616). `socialOn` is whether `social` is
 * effective for the viewer (the composed `social.participate` permission, data and never a role): it picks the
 * block dialog's body (D-722, D-724).
 */
export type PostMenuSafety = {
  socialOn: boolean;
  /**
   * The server actions, passed by the host exactly like `onLike` and `onDelete` are: a client component never
   * imports a server-only module of its own, which keeps this file free of `apps/web/lib/api` and its env.
   */
  reportAction: typeof reportContent;
  /** `blockMember` (`POST /v1/blocks/members/{membershipId}`), handed in the same way. */
  blockAction: typeof blockMember;
};

/** Who the block dialog names, and the membership id the block call is keyed by (never a user id, T-11-34). */
export type BlockTarget = { membershipId: string; name: string };

/** The reason value the API takes, by its catalog key (`safety.reasons.<key>`). */
const REASON_KEY: Record<ReportReason, string> = {
  offensive: 'offensive',
  harassment: 'harassment',
  spam: 'spam',
  sexual_violent: 'sexualViolent',
  other: 'other',
};

export type ReportAndBlockProps = {
  /** The subject being reported, or `null` while the sheet is closed. */
  report: ReportTarget | null;
  onReportClose: () => void;
  /** The tenant's display name: the intro names who will review ("A equipe de {tenant} vai analisar"). */
  tenantName: string;
  /** `reportContent`, handed in by the host (see `PostMenuSafety`). */
  reportAction: typeof reportContent;
  /** The member to block, or `null` while the dialog is closed. */
  block: BlockTarget | null;
  onBlockClose: () => void;
  blockAction: typeof blockMember;
  /** Whether `social` is effective for the viewer: picks the dialog's body (D-722, D-724). */
  socialOn: boolean;
};

/** The shared report sheet and block dialog. Controlled: the host owns both targets (see `useReportAndBlock`). */
export function ReportAndBlock({
  report,
  onReportClose,
  tenantName,
  reportAction,
  block,
  onBlockClose,
  blockAction,
  socialOn,
}: ReportAndBlockProps) {
  return (
    <>
      <ReportSheet
        report={report}
        onClose={onReportClose}
        tenantName={tenantName}
        reportAction={reportAction}
      />
      <BlockDialog
        block={block}
        onClose={onBlockClose}
        blockAction={blockAction}
        socialOn={socialOn}
      />
    </>
  );
}

/**
 * The block dialog (11-20, CHAT-07, D-722, D-724, UI-D-872): the shipped `ConfirmDialog` in its danger tone with
 * the `Ban` icon, titled by the person's name. The body has TWO variants chosen by whether `social` is effective
 * for the viewer, from DATA (`socialOn`, the composed `social.participate`, never a role): with `social` off the
 * block only hides their content; with it on the body also says the follows go and do not come back.
 *
 * - **One request.** The dialog locks both buttons while the call runs (the shipped pending state), so a double
 *   tap blocks once; `{ changed: false }` is the plain success, with ONE toast either way.
 * - **Failure.** `CANNOT_BLOCK`, the rate limit, a lost session and a lost network are the one shipped error toast
 *   (the API's one refusal names no reason); the dialog is released and the member can try again from the menu.
 * - **The name is React text** (T-11-16) and wraps with `break-words`; nothing here tells the blocked member
 *   anything, and no sentence implies they are told (T-11-03).
 */
function BlockDialog({
  block,
  onClose,
  blockAction,
  socialOn,
}: {
  block: BlockTarget | null;
  onClose: () => void;
  blockAction: typeof blockMember;
  socialOn: boolean;
}) {
  const t = useTranslations('safety');
  const tf = useTranslations('feed');
  const toast = useToast();

  // The last person stays in hand while the dialog animates out, so its title does not flip to a blank.
  const shown = useRef<BlockTarget | null>(block);
  if (block) shown.current = block;
  const target = block ?? shown.current;
  if (target === null) return null;

  const confirm = async () => {
    const result = await blockAction(target.membershipId);
    if (!result.ok) throw new Error(`block_${result.code}`);
    toast.show({ tone: 'success', message: t('block.blocked', { nome: target.name }) });
  };

  return (
    <ConfirmDialog
      open={block !== null}
      title={t('block.title', { nome: target.name })}
      body={t(socialOn ? 'block.bodySocialOn' : 'block.bodySocialOff', { nome: target.name })}
      icon={Ban}
      tone="danger"
      confirmLabel={t('block.confirm')}
      cancelLabel={t('block.cancel')}
      onConfirm={confirm}
      onClose={onClose}
      onError={(error) => {
        console.error('safety.block.failed', { error: String(error) });
        toast.show({ tone: 'error', message: tf('errors.generic') });
      }}
    />
  );
}

function ReportSheet({
  report,
  onClose,
  tenantName,
  reportAction,
}: {
  report: ReportTarget | null;
  onClose: () => void;
  tenantName: string;
  reportAction: typeof reportContent;
}) {
  const t = useTranslations('safety');
  const toast = useToast();
  const uid = useId();

  // The last subject stays in hand while the sheet animates out, so its title does not flip to a blank.
  const shown = useRef<ReportTarget | null>(report);
  if (report) shown.current = report;
  const target = report ?? shown.current;

  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);

  // A fresh open starts from a clean sheet: no reason, no note, no leftover failure.
  const open = report !== null;
  useEffect(() => {
    if (!open) return;
    setReason(null);
    setNote('');
    setPending(false);
    setFailed(false);
    inFlight.current = false;
  }, [open]);

  if (target === null) return null;

  const view = reportSubjectView(
    target.subjectType,
    t as unknown as Parameters<typeof reportSubjectView>[1],
    { voice: target.voice === true },
  );
  const noteLength = [...note].length;

  const finish = (code: ReportCode) => {
    if (code === 'ok') {
      toast.show({ tone: 'success', message: t('sheet.success') });
      onClose();
    } else if (code === 'already_reported') {
      toast.show({ tone: 'info', message: t('sheet.already') });
      onClose();
    } else if (code === 'unavailable') {
      toast.show({ tone: 'info', message: t('sheet.gone') });
      onClose();
    } else {
      setFailed(true);
    }
  };

  const submit = async () => {
    // The ref is what makes a second tap in the same frame a no-op, before `pending` re-renders.
    if (reason === null || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailed(false);
    let code: ReportCode = 'failed';
    try {
      const trimmed = note.trim();
      const result = await reportAction({
        subjectType: target.subjectType,
        subjectId: target.subjectId,
        reason,
        ...(trimmed === '' ? {} : { note: trimmed }),
      });
      code = result.code;
    } catch (error) {
      console.error('safety.report.submit_failed', { error: String(error) });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
    finish(code);
  };

  const introId = `${uid}-intro`;
  return (
    <BottomSheet open={open} onClose={pending ? () => undefined : onClose} title={view.sheetTitle}>
      <div data-report-sheet={target.subjectType} className="flex flex-col gap-4 pb-2">
        <div className="flex flex-col gap-1.5">
          <p id={introId} className="text-sm leading-relaxed text-text-secondary">
            {t('sheet.intro', { tenant: tenantName })}
          </p>
          {view.privacy === null ? null : (
            <p data-report-privacy className="text-sm leading-relaxed text-text-secondary">
              {view.privacy}
            </p>
          )}
        </div>

        <div role="radiogroup" aria-labelledby={introId} className="flex flex-col">
          {REPORT_REASONS.map((value) => (
            <label
              key={value}
              className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl px-1 py-2 text-sm text-text has-[:disabled]:cursor-default has-[:disabled]:opacity-60"
            >
              <input
                type="radio"
                name={`${uid}-reason`}
                value={value}
                checked={reason === value}
                disabled={pending}
                onChange={() => setReason(value)}
                className="h-5 w-5 shrink-0 accent-brand"
              />
              <span className="min-w-0 break-words">{t(`reasons.${REASON_KEY[value]}`)}</span>
            </label>
          ))}
        </div>

        <Textarea
          id={`${uid}-note`}
          label={t('sheet.noteLabel')}
          value={note}
          maxLength={REPORT_NOTE_MAX}
          counter={{ value: noteLength, max: REPORT_NOTE_MAX }}
          disabled={pending}
          onChange={(event) => setNote(event.target.value)}
        />

        {failed ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-sm text-danger"
          >
            <CircleAlert aria-hidden size={18} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{t('sheet.failure')}</span>
          </div>
        ) : null}

        <Button
          variant="brand"
          size="lg"
          fullWidth
          disabled={reason === null}
          loading={pending}
          onClick={() => void submit()}
        >
          {pending ? t('sheet.submitting') : t('sheet.submit')}
        </Button>
      </div>
    </BottomSheet>
  );
}

/**
 * The host's handle on the sheet for a SURFACE OF POSTS (the feed list and the post page, 11-20): the one state,
 * the element to render once, and the three things the module menus need: their label blocks with the safety
 * words added from the `safety` catalog (the module ships no language, so the host adds them), and the callbacks
 * that open the sheet. A surface never builds its own sheet, so every subject reads the same.
 *
 * `enabled` is false for a host that has not opted in: the labels come back untouched and the callbacks are
 * `undefined`, so the menus draw no safety row at all (no dead entry).
 */
export function useReportAndBlock({
  tenantName,
  safety,
}: {
  tenantName: string;
  safety: PostMenuSafety | undefined;
}) {
  const enabled = safety !== undefined;
  const t = useTranslations('safety');
  const [report, setReport] = useState<ReportTarget | null>(null);

  const reportPost = useCallback(
    (target: PostMenuTarget) => setReport({ subjectType: 'feed_post', subjectId: target.postId }),
    [],
  );
  const reportComment = useCallback(
    (comment: CommentView) => setReport({ subjectType: 'post_comment', subjectId: comment.id }),
    [],
  );
  const [block, setBlock] = useState<BlockTarget | null>(null);
  // The riders already say who may be blocked; a target without a membership id or a name is simply not
  // opened (the menus draw no row for it in the first place).
  const blockPost = useCallback((target: PostMenuTarget) => {
    if (target.authorMembershipId && target.authorName) {
      setBlock({ membershipId: target.authorMembershipId, name: target.authorName });
    }
  }, []);
  const blockComment = useCallback((comment: CommentView) => {
    const { membershipId, displayName } = comment.author;
    if (membershipId && displayName) setBlock({ membershipId, name: displayName });
  }, []);

  /** The post menu's labels with the report and block rows' words added ("Bloquear {nome}" keeps its placeholder). */
  const menuLabels = useCallback(
    (labels: PostMenuLabels): PostMenuLabels =>
      enabled
        ? { ...labels, report: t('menu.reportPost'), block: t.raw('menu.block') as string }
        : labels,
    [enabled, t],
  );
  /** The comment list's labels with the menu's three words added to the row block. */
  const commentLabels = useCallback(
    (labels: CommentsListLabels): CommentsListLabels =>
      enabled
        ? {
            ...labels,
            item: {
              ...labels.item,
              moreActions: t('menu.commentTrigger'),
              report: t('menu.reportComment'),
              block: t.raw('menu.block') as string,
            },
          }
        : labels,
    [enabled, t],
  );

  const element: ReactNode = useMemo(
    () =>
      safety ? (
        <ReportAndBlock
          report={report}
          onReportClose={() => setReport(null)}
          tenantName={tenantName}
          reportAction={safety.reportAction}
          block={block}
          onBlockClose={() => setBlock(null)}
          blockAction={safety.blockAction}
          socialOn={safety.socialOn}
        />
      ) : null,
    [safety, report, block, tenantName],
  );

  return {
    element,
    menuLabels,
    commentLabels,
    onReportPost: enabled ? reportPost : undefined,
    onReportComment: enabled ? reportComment : undefined,
    onBlockPost: enabled ? blockPost : undefined,
    onBlockComment: enabled ? blockComment : undefined,
  };
}
