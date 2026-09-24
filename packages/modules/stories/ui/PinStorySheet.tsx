'use client';

import { Switch } from '@tria/ui';
import { type ReactNode, useCallback, useRef, useState } from 'react';

/**
 * UI-D-41 — "Fixar em comunidades": one row per ACTIVE community, a `Switch` on each, and
 * **NO SAVE BUTTON**.
 *
 * That absence is the whole design, not a simplification. STORY-04 is "one or more communities",
 * which is a SET OF INDEPENDENT FACTS — one row in `story_community_pins` per community, one
 * request each. A `Salvar` would invent a transaction the schema does not have, and would leave the
 * admin believing a half-failed batch either fully applied or fully did not. Every toggle is
 * therefore its own immediate write, optimistic, reverting in place on failure.
 *
 * **THE LIST BODY IS INJECTED, and that is a boundary fact rather than a taste.** UI-D-41 and
 * UI-D-45 share one row list — `CommunityPickerSheet` in `@tria/module-communities/ui`, whose
 * trailing control is a prop precisely so this sheet can put a `Switch` where the picker puts a
 * check. But `turbo boundaries` denies a `module -> module` package edge (MOD-02), so this module
 * cannot IMPORT it. The host (`apps/web`, which may reach both) passes it in as `renderList`, and
 * `CommunityPickerSheetBody` below is the structural contract between the two. The identical
 * resolution 05-03, 05-05, 05-06 and 05-07 each reached; see `StoryViewer`'s `overlay` prop.
 *
 * **THREE THINGS A REVIEWER MUST NOT "FIX":**
 *
 * 1. **A failed toggle REVERTS and the ROW STAYS** (UI partial/E09). The commonest cause is a
 *    community archived between render and tap, and removing the row mid-gesture would be a worse
 *    answer than the failure: the admin would watch a community vanish and not know why. There is
 *    no inline message and the sheet does not dismiss — the host fires the generic error toast and
 *    the admin retries in place.
 * 2. **A second toggle while one is in flight is a NO-OP** (UI loading/E09), not a queue and not a
 *    cancel. Two crossing writes for one row can settle in either order, and the losing one would
 *    leave the switch describing a state the server does not hold.
 * 3. **The EMPTY case is the host's node** (UI empty/E09). A tenant with no communities gets
 *    "Nenhuma comunidade ainda." plus a link to CREATE one — words and a route this module owns
 *    neither of (PWA-03, MOD-02).
 */

/**
 * The community row this sheet draws — structurally the row `CommunityPickerSheet` takes, declared
 * here because the boundary forbids importing that package's types. `apps/web` maps
 * `CommunitySummary` onto this in ONE place, so these five fields are the whole contract between
 * the two modules and TypeScript checks it at that call site.
 */
export interface PinStoryCommunityRow {
  id: string;
  name: string;
  /** Null takes the `--brand-gradient` branch (D-69/UI-D-35) in whichever body is injected. */
  coverAssetId: string | null;
  coverVariantWidths: readonly number[];
  coverAlt: string;
}

/**
 * The injected list body's call signature — `CommunityPickerSheet`'s props, minus `onSelect`.
 *
 * `onSelect` is deliberately absent: with a `Switch` as the trailing control the SWITCH is the
 * control, and a tappable row wrapping it would nest one interactive element inside another.
 */
export type CommunityPickerSheetBody = (props: {
  open: boolean;
  onClose: () => void;
  title: string;
  helper?: string;
  rows: readonly PinStoryCommunityRow[];
  rowLabel: (row: PinStoryCommunityRow) => string;
  trailing: (row: PinStoryCommunityRow) => ReactNode;
  leadingRow?: ReactNode;
}) => ReactNode;

export interface PinStorySheetProps {
  open: boolean;
  onClose: () => void;
  /** "Fixar em comunidades" — the host's words. */
  title: string;
  /** The one-line helper under it. The host's words. */
  helper?: string;
  /** Every ACTIVE community, from the page's own read. */
  rows: readonly PinStoryCommunityRow[];
  /** The community ids this story is currently pinned to — the sheet's initial state. */
  pinnedCommunityIds: readonly string[];
  /** The row's accessible name ("Fixar em {community}"). A function: only the host has the words. */
  rowLabel: (row: PinStoryCommunityRow) => string;
  /**
   * ONE toggle, ONE request. Resolves `true` when the write landed and `false` to REVERT — the
   * host owns the error toast, because the sheet has no words of its own to put in one.
   */
  onToggle: (communityId: string, next: boolean) => Promise<boolean>;
  /** UI empty/E09: rendered INSIDE the sheet when there are no communities at all. */
  empty: ReactNode;
  /** The shared community row list, injected by the host. See the docblock above. */
  renderList: CommunityPickerSheetBody;
}

export function PinStorySheet({
  open,
  onClose,
  title,
  helper,
  rows,
  pinnedCommunityIds,
  rowLabel,
  onToggle,
  empty,
  renderList,
}: PinStorySheetProps) {
  const [pinned, setPinned] = useState<ReadonlySet<string>>(() => new Set(pinnedCommunityIds));

  /**
   * **RE-SEED WHEN THE TARGET CHANGES.** The sheet stays MOUNTED while it is closed (so its exit
   * animation can play), so a `useState` initialiser alone runs exactly once — for the FIRST story
   * the admin ever opens it on — and every story after that would inherit the first one's pins.
   * That is not a theoretical hazard: it is the defect `stories.spec.ts` caught, where a story the
   * seed had pinned opened with its switch off.
   *
   * Adjusting state during render is React's documented alternative to an effect, and it is what
   * keeps the switches and the prop in lockstep with no paint of the previous story's state — the
   * `MembersList` idiom, restated. The identity of `pinnedCommunityIds` is the signal: the host
   * hands a fresh array with every target.
   */
  const [seed, setSeed] = useState(pinnedCommunityIds);
  if (seed !== pinnedCommunityIds) {
    setSeed(pinnedCommunityIds);
    setPinned(new Set(pinnedCommunityIds));
  }

  /**
   * A REF rather than state: it gates the handler, and re-rendering on every in-flight change
   * would flash the row twice for one tap. Nothing renders from it.
   */
  const inFlight = useRef<Set<string>>(new Set());

  const toggle = useCallback(
    (communityId: string, next: boolean) => {
      // Point 2: the second tap of a row whose write has not settled does NOTHING at all.
      if (inFlight.current.has(communityId)) return;
      inFlight.current.add(communityId);

      // Optimistic: the control moves now, so a one-row write never shows a spinner.
      setPinned((current) => {
        const updated = new Set(current);
        if (next) updated.add(communityId);
        else updated.delete(communityId);
        return updated;
      });

      void onToggle(communityId, next)
        .then((ok) => {
          if (ok) return;
          // Point 1: revert in place. The ROW STAYS and the sheet stays open.
          setPinned((current) => {
            const reverted = new Set(current);
            if (next) reverted.delete(communityId);
            else reverted.add(communityId);
            return reverted;
          });
        })
        .catch(() => {
          setPinned((current) => {
            const reverted = new Set(current);
            if (next) reverted.delete(communityId);
            else reverted.add(communityId);
            return reverted;
          });
        })
        .finally(() => {
          inFlight.current.delete(communityId);
        });
    },
    [onToggle],
  );

  return renderList({
    open,
    onClose,
    title,
    helper,
    rows,
    rowLabel,
    trailing: (row) => (
      <Switch
        checked={pinned.has(row.id)}
        onChange={(next) => toggle(row.id, next)}
        label={rowLabel(row)}
      />
    ),
    // The empty node rides the body's leading slot, so the copy and its CTA sit INSIDE the sheet
    // rather than under an empty switch list.
    leadingRow: rows.length === 0 ? empty : undefined,
  });
}
