'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
import {
  type BuyerPermissions,
  PERMISSION_ORDER,
  type PermissionKey,
} from '@/lib/store-permissions';

/**
 * 11.1-12 (UI-D-883, UI-D-884, UI-D-885, D-890): the buyer-permission group of ONE chosen community in
 * the product form. A controlled component: it draws the five flags it is given, in the fixed order
 * (Curtir, Comentar, Compartilhar, Postar na comunidade, Postar story), and answers every tick with
 * the WHOLE next value. It holds no state, reads no role and computes nothing: the stored flags, the
 * defaults, the `social`-off line and the open-highlight count are finished facts the form hands in.
 *
 * One native `<fieldset>` with a visible legend plus an `sr-only` " em {community}" suffix (its
 * accessible name is the whole sentence), five native checkboxes each inside a `<label>` that IS the
 * 44px row (the `ConsentFields` / `OptionRow` pattern: no new primitive, no master tick-all, no card).
 * A forbidden state is not drawn: all five unticked warns nothing.
 *
 * The community name is untrusted: it only ever reaches the DOM as React text through the catalog
 * (T-11.1-46).
 */
export interface ProductCommunityPermissionsProps {
  community: { id: string; name: string };
  value: BuyerPermissions;
  onChange: (next: BuyerPermissions) => void;
  disabled: boolean;
  /**
   * The id of the form's ONE `social`-off line, set only while that line is drawn: it describes both
   * post boxes (UI-D-885). Absent = nothing to describe.
   */
  socialNoteId?: string;
  /**
   * True when the "no highlight open to buyers" line shows under this group (the form decided from the
   * ticked story flag and a known zero count). The line is plain text, never a link (A-UI-5).
   */
  noOpenHighlight?: boolean;
}

export function ProductCommunityPermissions({
  community,
  value,
  onChange,
  disabled,
  socialNoteId,
  noOpenHighlight = false,
}: ProductCommunityPermissionsProps) {
  const t = useTranslations('store');
  const noteId = useId();

  const labels: Record<PermissionKey, string> = {
    like: t('form.communities.permissions.like'),
    comment: t('form.communities.permissions.comment'),
    share: t('form.communities.permissions.share'),
    post: t('form.communities.permissions.post'),
    story: t('form.communities.permissions.story'),
  };

  /** UI-D-885: the social-off line describes both post boxes, the open-highlight line the story box. */
  const describedBy = (key: PermissionKey): string | undefined => {
    const ids: string[] = [];
    if ((key === 'post' || key === 'story') && socialNoteId !== undefined) ids.push(socialNoteId);
    if (key === 'story' && noOpenHighlight) ids.push(noteId);
    return ids.length > 0 ? ids.join(' ') : undefined;
  };

  return (
    <>
      <fieldset
        data-product-permissions={community.id}
        className="m-0 flex min-w-0 flex-col border-0 p-0"
      >
        <legend className="p-0 text-xs font-normal text-text-secondary">
          {t('form.communities.permissions.legend')}
          <span className="sr-only">
            {t('form.communities.permissions.legendCommunity', { community: community.name })}
          </span>
        </legend>
        {PERMISSION_ORDER.map((key) => (
          <label key={key} className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="size-5 shrink-0 rounded border-border accent-brand"
              checked={value[key]}
              disabled={disabled}
              aria-describedby={describedBy(key)}
              onChange={() => onChange({ ...value, [key]: !value[key] })}
            />
            <span className="min-w-0 break-words text-sm font-normal text-text">{labels[key]}</span>
          </label>
        ))}
      </fieldset>
      {noOpenHighlight ? (
        <p
          id={noteId}
          data-product-no-open-highlight={community.id}
          className="text-xs font-normal text-text-tertiary"
        >
          {t('form.communities.permissions.noOpenHighlight')}
        </p>
      ) : null}
    </>
  );
}
