'use client';

import { BottomSheet, IconButton } from '@rede-social/ui';
import { Ban, Ellipsis, Flag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { type PostMenuSafety, useReportAndBlock } from '@/components/feed/ReportAndBlock';
import { StoryMenuRow } from '@/components/stories/StoryMenuRow';

/**
 * The community header's "Mais opções da comunidade" (11-24, D-733, AD-1, AD-8, UI-D-869): an `Ellipsis` control
 * in the header's action cluster, beside the creator's and the moderator's edit pencil, opening the sheet
 * "Opções da comunidade" with "Denunciar comunidade" and, when the API's rider allows it, "Bloquear {nome}".
 *
 * **The rows are DATA, never a role.** The host passes `canReport` and `block` from the community viewer's
 * `canReport` and `canBlock` riders (plan 15): the creator of the community gets neither (so the control is not
 * drawn for them at all), staff get Denunciar and never Bloquear (A-11-ROLE), and an organization community has no
 * member creator to block. The control also ignores `social` (AD-8): reporting and blocking are moderation, not
 * social features, and only the block dialog's BODY reads the composed `social.participate` (D-722, D-724).
 *
 * **It renders nothing when there is nothing to offer**, so a header with no entry draws no dead control. The host
 * also never mounts it on the locked page, the archived page or the not-found screen, where no content is shown.
 *
 * The sheet and the dialog are plan 20's `ReportAndBlock` (one for every subject): this file only chooses the
 * subject (`community`) and who the dialog names. A community's name and its creator's name are React text only
 * (T-11-16). Nothing here tells the creator they were reported (T-11-03).
 */
export type CommunityMenuProps = {
  communityId: string;
  /** The viewer's `canReport` rider: the viewer did not create the community. */
  canReport: boolean;
  /**
   * Who "Bloquear {nome}" names and the block call is keyed by (a membership id, never a user id, T-11-34): set
   * only when the viewer's `canBlock` rider is true for a member-created community whose creator is known.
   */
  block: { membershipId: string; name: string } | null;
  /** The tenant's display name: the report sheet's intro names who will review. */
  tenantName: string;
  /** `postMenuSafety(bootstrap)`: the server actions as props, and whether `social` is on. */
  safety: PostMenuSafety;
};

export function CommunityMenu({
  communityId,
  canReport,
  block,
  tenantName,
  safety,
}: CommunityMenuProps) {
  const t = useTranslations('safety');
  const [open, setOpen] = useState(false);
  const reportAndBlock = useReportAndBlock({ tenantName, safety });
  // The header's cluster is a `z-10` stacking context over the cover, so a sheet drawn inside it would sit UNDER
  // the app's own chrome. The sheet and the dialog are drawn on `document.body` instead (the profile trigger's
  // portal idiom), after the first client render so the server markup has none.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => setPortalTarget(document.body), []);

  if (!canReport && block === null) return null;

  return (
    <>
      <IconButton
        icon={Ellipsis}
        size={20}
        label={t('menu.communityTrigger')}
        data-community-more
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        // The same cover-safe chip as the back control and the pencil, so the cluster reads as one family.
        className="bg-black/40 text-white backdrop-blur-sm hover:bg-black/55 active:bg-black/55 focus-visible:ring-white focus-visible:ring-offset-black/40"
      />
      {portalTarget
        ? createPortal(
            <>
              <BottomSheet
                open={open}
                onClose={() => setOpen(false)}
                title={t('menu.communityTitle')}
              >
                <div className="flex flex-col gap-1">
                  {canReport ? (
                    <StoryMenuRow
                      icon={Flag}
                      label={t('menu.reportCommunity')}
                      onClick={() => {
                        setOpen(false);
                        reportAndBlock.openReport({
                          subjectType: 'community',
                          subjectId: communityId,
                        });
                      }}
                    />
                  ) : null}
                  {block ? (
                    <StoryMenuRow
                      icon={Ban}
                      label={t('menu.block', { nome: block.name })}
                      onClick={() => {
                        setOpen(false);
                        reportAndBlock.openBlock(block);
                      }}
                    />
                  ) : null}
                </div>
              </BottomSheet>
              {reportAndBlock.element}
            </>,
            portalTarget,
          )
        : null}
    </>
  );
}
