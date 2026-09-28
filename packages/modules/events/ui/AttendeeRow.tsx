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
}

/**
 * One `Participantes` row (UI-D-213, sketch 006 Surface 6): `min-h-14 flex items-center gap-3 py-2
 * border-b border-divider`, then `Avatar sm` (32), a `min-w-0 flex-1` column with the name 14/700
 * `truncate` (or the removed label 14/400 tertiary) and the meta 12/400 tertiary `tabular-nums`, and
 * the optional `tag` slot, `shrink-0`, so a long name ellipsises BEFORE the tag.
 *
 * **Not a link in V1** (D-47): the row is static, so the organiser's list is never a second door into
 * the member directory. A removed member gets no photo (the payload has none) and the neutral icon.
 * Presentational and props-only; it **ships no words** (PWA-03).
 */
export function AttendeeRow({ name, removed, avatarUrl, meta, tag }: AttendeeRowProps) {
  return (
    <div
      data-testid="attendee-row"
      data-removed={removed ? 'true' : undefined}
      className="flex min-h-14 items-center gap-3 border-b border-divider py-2"
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
      </div>
      {tag ? <span className="shrink-0">{tag}</span> : null}
    </div>
  );
}
