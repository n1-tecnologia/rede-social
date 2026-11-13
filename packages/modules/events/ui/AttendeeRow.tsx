import { Avatar } from '@rede-social/ui';
import type { ReactNode } from 'react';

export interface AttendeeRowProps {
  /** The member's display name, or the host's "Membro removido" label when `removed`. */
  name: string;
  /** A member who has left: the label renders 14/400 tertiary and the avatar is the neutral icon. */
  removed: boolean;
  /** The stable avatar path (`/v1/media/{assetId}/w128`), or `null` for the neutral icon. */
  avatarUrl: string | null;
  /** The finished meta line: "Confirmou em …" / "Check-in às …" / "Respondeu em …". */
  meta: string;
  /** An optional trailing tag (`shrink-0`): the neutral "Sem confirmação" pill on a walk-in. */
  tag?: ReactNode;
  /**
   * Phase 10.1-14 (UI-D-754): the finished pills of a PAID event's row, in the host's fixed order (the
   * origin, "Reembolsado", "Acima do limite"). They draw as a wrapping line under the meta; missing or
   * empty, the row is exactly the shipped one (a free event's).
   */
  marks?: ReactNode[];
  /**
   * Phase 10.1-14 (UI-D-755, UI-D-756): the row's one action ("Remover cortesia", "Liberar presença"),
   * filled by the host. A SIBLING of the text column that never shrinks; below 360px it wraps under the
   * column (the `EventRow` pattern), so a long name keeps its width.
   */
  action?: ReactNode;
}

/**
 * One `Participantes` row (UI-D-213, sketch 006 Surface 6): `min-h-14 flex items-center gap-3 py-2
 * border-b border-divider`, then `Avatar sm` (32), a `min-w-0 flex-1` column with the name 14/700
 * `truncate` (or the removed label 14/400 tertiary) and the meta 12/400 tertiary `tabular-nums`, and
 * the optional `tag` slot, `shrink-0`, so a long name ellipsises BEFORE the tag. A paid event's row adds
 * the `marks` pills line under the meta and the `action` slot last (10.1-14).
 *
 * **Not a link in V1** (D-47): the row is static, so the organiser's list is never a second door into
 * the member directory. A removed member gets no photo (the payload has none) and the neutral icon.
 * Presentational and props-only; it **ships no words** (PWA-03).
 */
export function AttendeeRow({
  name,
  removed,
  avatarUrl,
  meta,
  tag,
  marks,
  action,
}: AttendeeRowProps) {
  return (
    <div
      data-testid="attendee-row"
      data-removed={removed ? 'true' : undefined}
      className={
        action
          ? 'flex min-h-14 flex-wrap items-center gap-x-3 border-b border-divider py-2'
          : 'flex min-h-14 items-center gap-3 border-b border-divider py-2'
      }
    >
      <Avatar src={removed ? null : avatarUrl} alt={name} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col">
        <p
          className={
            removed
              ? 'truncate text-sm font-normal text-text-tertiary'
              : 'truncate text-sm font-bold text-text'
          }
        >
          {name}
        </p>
        <p className="truncate text-xs font-normal tabular-nums text-text-tertiary">{meta}</p>
        {marks && marks.length > 0 ? (
          <div data-attendee-marks className="mt-1 flex flex-wrap gap-1">
            {marks}
          </div>
        ) : null}
      </div>
      {tag ? <span className="shrink-0">{tag}</span> : null}
      {action ? (
        <div
          data-attendee-action
          className="shrink-0 max-[359px]:basis-full max-[359px]:pt-2 max-[359px]:pl-11"
        >
          {action}
        </div>
      ) : null}
    </div>
  );
}
