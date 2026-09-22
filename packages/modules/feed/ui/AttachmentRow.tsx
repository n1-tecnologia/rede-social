'use client';

import { mediaVariantUrl } from '@tria/contracts/media';
import { Download, FileText, Loader2 } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

/**
 * One file attached to a post, as the card renders it (UI-SPEC §Attachment contract, UI-D-23).
 *
 * Every string arrives already built by the host: the module formats no byte count and speaks no
 * language (PWA-03). `sizeLabel` is `null` when the stored size is missing, and the second line then
 * carries the type ALONE — never "PDF · undefined" and never a dangling separator.
 */
export type AttachmentDescriptor = {
  assetId: string;
  /** The filename as the admin uploaded it. Truncated visually, never in the DOM. */
  filename: string;
  /** "PDF" — derived from the mime by the host, because the label is language. */
  typeLabel: string;
  /** Already formatted pt-BR ("1,2 MB"), or `null` when `media_assets.bytes` is unknown. */
  sizeLabel: string | null;
  /** "Baixar {name}" — the row's accessible name, already interpolated. */
  downloadLabel: string;
};

export type AttachmentRowProps = {
  attachment: AttachmentDescriptor;
  /** Raised once per failed download; the host turns it into the GENERIC error toast (UI-D-23). */
  onError: () => void;
};

/**
 * **The download is a fetch-then-save, not a signed URL in a payload.** 03-01 forbids a signed
 * Storage URL from appearing in any API payload, so there is no "give me a download URL" route: the
 * row fetches the STABLE `/v1/media/{assetId}/original` path through the Next BFF handler, which
 * forwards the API's tenant-checked 302. The signed URL therefore lives and dies inside the redirect
 * chain — it never reaches application code, a log line or the DOM (T-04-23).
 *
 * Reading the response as a blob is what gives UI-D-23 its REAL pending and error states: the row
 * goes `aria-busy` for exactly as long as the round trip lasts, a second tap while busy is a no-op
 * (each one would otherwise burn another round trip), and a refusal restores the glyph and raises
 * the generic failure with no inline message and no reflow. Phase 3's 25 MiB PDF-only cap
 * (`MEDIA_LIMITS.file.attachment`) is what bounds the blob's memory cost (T-04-26).
 */
export function AttachmentRow({ attachment, onError }: AttachmentRowProps) {
  // A REF, not the state below: the guard has to flip before the first `await`, because a second
  // click can land before React commits `pending` (the 04-02 re-entrancy lesson).
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);

  const download = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);

    let objectUrl: string | null = null;
    try {
      const response = await fetch(mediaVariantUrl(attachment.assetId, 'original'));
      if (!response.ok) throw new Error(`media responded ${response.status}`);

      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      // The name the browser saves under is the STORED filename, not the object key.
      anchor.download = attachment.filename;
      anchor.rel = 'noopener';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      // The raw value goes to the console only; the member sees the generic message (T-03-51).
      console.error('feed.attachment_download_failed', { error: String(error) });
      onError();
    } finally {
      if (objectUrl !== null) {
        const url = objectUrl;
        // Revoked on the next tick: the save is started asynchronously after the click, and
        // revoking inside the same task can cancel it in Safari.
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      inFlight.current = false;
      setPending(false);
    }
  }, [attachment.assetId, attachment.filename, onError]);

  return (
    <button
      type="button"
      aria-label={attachment.downloadLabel}
      aria-busy={pending}
      onClick={() => void download()}
      className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border px-3 py-3 text-left transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-bg-tertiary">
        <FileText aria-hidden size={20} className="text-text-tertiary" />
      </span>

      <span className="min-w-0 flex-1">
        {/* `title` is the accessible escape hatch for a name the 320px row has to cut: UI-SPEC E07's
            long-text row is a 94-character filename that must truncate WITHOUT growing min-h-14. */}
        <span title={attachment.filename} className="block truncate text-sm font-bold text-text">
          {attachment.filename}
        </span>
        <span
          data-testid="attachment-meta"
          className="block truncate text-xs font-normal tabular-nums text-text-tertiary"
        >
          {attachment.sizeLabel === null
            ? attachment.typeLabel
            : `${attachment.typeLabel} · ${attachment.sizeLabel}`}
        </span>
      </span>

      {/* The geometry does not change between the two: a 20px glyph swaps for a 20px spinner, so a
          pending row never reflows the card beneath it (UI-D-23). */}
      {pending ? (
        <Loader2
          aria-hidden
          data-testid="attachment-spinner"
          size={20}
          className="shrink-0 animate-spin text-text-tertiary motion-reduce:animate-none"
        />
      ) : (
        <Download
          aria-hidden
          data-testid="attachment-download-glyph"
          size={20}
          className="shrink-0 text-text-tertiary"
        />
      )}
    </button>
  );
}
