/**
 * 11.1-10 (UI-D-886, UI-D-887, D-884): the "Aberto a compradores" switch as pure facts. The curator's
 * highlight read carries `openToBuyers` (a member never receives it); every function here takes
 * finished facts and compares no role, product or entitlement. The host (`HighlightManager`) reads
 * these and hands the module's edit sheet its finished slot; the catalog keys are returned as keys,
 * never as words, because words live in the host catalog (PWA-03, MOD-02).
 */

/** The switch value of one highlight: an API that predates the field omits it, which reads as closed. */
export function highlightOpenState(highlight: { openToBuyers?: boolean }): boolean {
  return highlight.openToBuyers === true;
}

/**
 * Whether the edit sheet draws the switch section at all. Absent, never disabled, for a highlight of
 * a member-created community, of Início (no community) and of an archived community (UI-D-886): the
 * API refuses those with `open_unavailable`, and the sheet never offers what it would refuse.
 * `member` is the host's own finished fact (`HighlightManager`'s `member` prop).
 */
export function highlightOpenSectionVisible(input: {
  place: { communityId: string | null };
  archived: boolean;
  member?: boolean;
}): boolean {
  return input.place.communityId !== null && !input.archived && input.member !== true;
}

/** The catalog keys of the two toasts, under the `stories` namespace. */
export type OpenToBuyersToastKey =
  | 'highlights.edit.openToBuyers.toastOn'
  | 'highlights.edit.openToBuyers.toastOff';

/** The toast for the value the switch just moved to. */
export function openToBuyersToastKey(next: boolean): OpenToBuyersToastKey {
  return next ? 'highlights.edit.openToBuyers.toastOn' : 'highlights.edit.openToBuyers.toastOff';
}
