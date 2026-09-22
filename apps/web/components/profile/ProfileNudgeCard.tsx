'use client';

import { PURPOSE_WIDTHS } from '@tria/contracts/media';
import { Avatar, Button, Card, useToast } from '@tria/ui';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { dismissNudgeAction } from '@/app/(app)/perfil/actions';
import { LinkButton } from '@/app/(auth)/LinkButton';
import { MediaImage } from '@/components/media/MediaImage';

export interface ProfileNudgeCardProps {
  displayName: string;
  /** Normally `null` — the neutral fallback icon IS the point of the card (UI-SPEC §Home nudge). */
  avatarAssetId: string | null;
}

/**
 * The D-02 first-access nudge (R-13, UI-SPEC §Home nudge card): one dismissible card on `/inicio`
 * inviting a member who has neither a photo nor a bio to finish their profile.
 *
 * **It is a card, never a modal.** A first-access interstitial is hostile on a phone and competes
 * with the invite/consent flow; this sits in the page, subordinate to the welcome block, and is
 * skippable by simply scrolling past it. There is exactly ONE visible dismissal ("Agora não") and
 * **no `X` glyph** — a second affordance for the same action is a second nag.
 *
 * **The dismissal is SERVER state.** "Agora não" writes `member_profiles.nudge_dismissed_at`, so it
 * survives a different device and a PWA reinstall whose storage the OS evicted. `localStorage`
 * would re-nag someone who already said no.
 *
 * **Nothing is removed optimistically.** The card disappears because the server re-rendered `/inicio`
 * without it, not because the button was clicked: if the write FAILS the card must still be there,
 * with the failure surfaced (the generic error toast) rather than swallowed. A card that vanishes on
 * click and returns on the next load is the worst of both — it reads as a bug and it re-nags. This
 * closes the UI-SPEC's E5/error backstop with an explicit, tested behaviour.
 */
export function ProfileNudgeCard({ displayName, avatarAssetId }: ProfileNudgeCardProps) {
  const t = useTranslations('profile');
  const { show } = useToast();
  const [pending, startTransition] = useTransition();

  const dismiss = () => {
    startTransition(async () => {
      let ok = false;
      try {
        ok = (await dismissNudgeAction()).ok;
      } catch (error) {
        console.error('profile.nudge_dismiss_failed', { error: String(error) });
      }
      // On success the action revalidated `/inicio`, so the server drops the card on its own.
      if (!ok) show({ tone: 'error', message: t('errors.generic') });
    });
  };

  return (
    <Card className="p-4" data-nudge>
      <div className="flex items-start gap-3">
        {avatarAssetId ? (
          <MediaImage
            assetId={avatarAssetId}
            widths={PURPOSE_WIDTHS.avatar}
            baseWidth={128}
            alt={displayName}
            sizes="40px"
            ratio="aspect-square"
            className="h-10 w-10 shrink-0 rounded-full"
            fallback={<Avatar size="md" alt={displayName} />}
          />
        ) : (
          <Avatar size="md" alt={displayName} />
        )}

        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-bold text-text">{t('nudge.title')}</p>
          <p className="text-xs text-text-secondary">{t('nudge.body')}</p>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <LinkButton href="/perfil/editar" variant="brand" className="h-9 px-4 text-xs">
          {t('nudge.action')}
        </LinkButton>
        <Button variant="ghost" size="sm" loading={pending} onClick={dismiss}>
          {t('nudge.dismiss')}
        </Button>
      </div>
    </Card>
  );
}
