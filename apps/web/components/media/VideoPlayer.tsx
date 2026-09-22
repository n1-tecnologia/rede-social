'use client';

import type { MediaStatus } from '@tria/contracts/media';
import { Button, Card, StatusPill, useToast } from '@tria/ui';
import { Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPlaybackTokenAction } from '@/app/(app)/configuracoes/midia/actions';

/**
 * `<mux-player>` is a CUSTOM ELEMENT: it registers itself against `window.customElements` at import
 * time, which does not exist during a server render (RESEARCH A3). `next/dynamic` with
 * `ssr: false` is the documented way to keep it out of the server bundle entirely; the
 * `aspect-video bg-bg-tertiary` frame below is what the member sees until it loads, so there is no
 * layout shift and no spinner over a video.
 */
const MuxPlayer = dynamic(() => import('@mux/mux-player-react'), { ssr: false });

export type VideoPlayerStatus = MediaStatus;

export interface VideoPlayerProps {
  assetId: string;
  /** The asset's own status; only `ready` ever mints a token. */
  status: VideoPlayerStatus;
}

/** What the element type exposes that this component reads — its OWN derived poster URL. */
type PosterReadable = { poster?: string };

/** How often, and for how long, the poster probe waits for the custom element to upgrade. */
const POSTER_PROBE_STEP_MS = 120;
const POSTER_PROBE_TIMEOUT_MS = 3000;

/**
 * The three states of UI-SPEC §Video contract (D-43/D-44, E10). There is no fourth and no "empty":
 * the player is only ever rendered for an asset that exists.
 *
 * **`processing`** — an `aspect-video bg-bg-tertiary rounded-xl` frame with a centred `Loader2` 28
 * `text-brand` and the two copy lines. Under `prefers-reduced-motion: reduce` (which is what
 * Tailwind's `motion-reduce:` variant compiles to) the spinner does NOT spin and the copy carries
 * the state on its own.
 *
 * **`ready`** — the token is minted PER REQUEST against the caller's membership when the player
 * opens (D-44) and lives in this closure only: it is never cached, stored or put in a URL that
 * outlives the session. A failed mint and a mid-session expiry both surface the GENERIC toast plus a
 * ghost "Tentar novamente" that mints a fresh one — a raw player error, a provider status or a token
 * fragment never reaches the screen (T-03-51).
 *
 * **`failed`** — the danger pill and the catalog line, with NO player frame rendered at all.
 *
 * **E10/partial (the held-out backstop):** a `ready` asset whose still does not resolve — the
 * provider has not generated it yet, or the thumbnail token was refused — must not draw a
 * broken-image glyph. There are exactly three cases, and `data-poster` reports which one happened:
 *
 *  1. the element exposes NO poster URL at all → `none`, and nothing was ever requested;
 *  2. it exposes one that loads → `derived`;
 *  3. it exposes one that fails → the probe catches it and the element is told `poster=""` → `none`.
 *
 * Both mechanisms are verified against `@mux/mux-player@3.13.4`'s `dist/base.mjs`, not assumed:
 * `get poster()` returns an explicitly set attribute — the empty string included — before deriving
 * anything, so `""` really does mean "no poster"; and its thumbnail-URL builder returns `undefined`
 * whenever a token is present whose decoded `aud` claim is not `'t'`. The local fake provider mints
 * deterministic NON-JWT tokens, so case 1 is what every local and CI run exercises: the player
 * itself declines to build a still and the frame falls back to its plain `bg-bg-tertiary` ground.
 * Case 3 is the one a real Mux thumbnail token (`aud: 't'`) can reach, and it is covered by the same
 * `none` outcome. This component never constructs a vendor URL — it only ever asks the element.
 */
export function VideoPlayer({ assetId, status }: VideoPlayerProps) {
  const t = useTranslations('media');
  const toast = useToast();
  const frameRef = useRef<HTMLDivElement | null>(null);

  const [tokens, setTokens] = useState<{
    playbackId: string;
    playback: string;
    thumbnail: string;
    storyboard: string;
  } | null>(null);
  const [minting, setMinting] = useState(false);
  const [refused, setRefused] = useState(false);
  /** `undefined` = let the player derive its own poster; `''` = no poster at all (see the docblock). */
  const [poster, setPoster] = useState<string | undefined>(undefined);
  /** Which of the three poster cases this render is in — observable, so the backstop is testable. */
  const [posterState, setPosterState] = useState<'pending' | 'none' | 'derived'>('pending');

  const mint = useCallback(async () => {
    setMinting(true);
    setRefused(false);
    setPoster(undefined);
    setPosterState('pending');
    try {
      const result = await fetchPlaybackTokenAction(assetId);
      if (!result.ok) {
        setRefused(true);
        // ALWAYS the generic message: the refusal code is a catalog key, never a status or a
        // provider string, and the member is told to try again rather than told what broke.
        toast.show({ tone: 'error', message: t('errors.generic') });
        return;
      }
      setTokens({
        playbackId: result.playback.playbackId,
        playback: result.playback.tokens.playback,
        thumbnail: result.playback.tokens.thumbnail,
        storyboard: result.playback.tokens.storyboard,
      });
    } catch (unexpected) {
      // The raw value goes to the console only (T-02-147 / T-03-51).
      console.error('media.playback_token_failed', { error: String(unexpected) });
      setRefused(true);
      toast.show({ tone: 'error', message: t('errors.generic') });
    } finally {
      setMinting(false);
    }
  }, [assetId, t, toast]);

  useEffect(() => {
    if (status !== 'ready') return;
    void mint();
  }, [status, mint]);

  // E10/partial backstop — see the docblock for the three cases.
  //
  // The element is found through the FRAME, not through a React ref: `next/dynamic` wraps the
  // component and a forwarded ref is not guaranteed to reach the custom element, whereas the DOM
  // node is always there once it has upgraded. The short poll IS that upgrade window — a custom
  // element defined by a dynamically imported chunk is not upgraded on the first commit.
  useEffect(() => {
    if (!tokens) return;
    let cancelled = false;
    let probe: HTMLImageElement | null = null;
    let elapsed = 0;
    const timer = setInterval(() => {
      if (cancelled) return;
      elapsed += POSTER_PROBE_STEP_MS;
      const element = frameRef.current?.querySelector('mux-player') as PosterReadable | null;
      const url = element?.poster;
      if (!url) {
        // Case 1: the player declined to build a still. It stays declined — there is nothing to
        // probe and nothing that could draw a broken glyph.
        if (elapsed >= POSTER_PROBE_TIMEOUT_MS) {
          clearInterval(timer);
          if (!cancelled) setPosterState('none');
        }
        return;
      }
      clearInterval(timer);
      probe = new Image();
      probe.onload = () => {
        if (!cancelled) setPosterState('derived');
      };
      probe.onerror = () => {
        if (cancelled) return;
        // Case 3: `""` is what makes the getter answer "no poster" instead of re-deriving the URL
        // it just failed to load.
        setPoster('');
        setPosterState('none');
      };
      probe.src = url;
    }, POSTER_PROBE_STEP_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (probe) {
        probe.onerror = null;
        probe.onload = null;
      }
    };
  }, [tokens]);

  if (status === 'failed' || status === 'rejected') {
    // NO player frame at all — there is nothing to play, and an empty 16:9 box would suggest there is.
    return (
      <div className="flex flex-col items-start gap-2 p-4" data-testid="video-failed">
        <StatusPill tone={status === 'failed' ? 'danger' : 'neutral'}>
          {t(status === 'failed' ? 'status.failed' : 'status.rejected')}
        </StatusPill>
        <p className="text-sm text-danger">{t('player.failed')}</p>
      </div>
    );
  }

  if (status !== 'ready') {
    return (
      <Card className="p-4" data-testid="video-processing">
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl bg-bg-tertiary">
          <Loader2
            aria-hidden
            size={28}
            className="animate-spin text-brand motion-reduce:animate-none"
            data-testid="video-processing-spinner"
          />
          <p className="text-sm text-text-secondary">{t('player.processing.title')}</p>
          <p className="max-w-[280px] text-center text-xs text-text-tertiary">
            {t('player.processing.body')}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 p-4"
      data-testid="video-ready"
      // The backstop is OBSERVABLE rather than merely "nothing visibly broke" — a shadow-DOM poster
      // would hide the difference from a test.
      data-poster={posterState}
    >
      <div ref={frameRef} className="aspect-video w-full overflow-hidden rounded-xl bg-bg-tertiary">
        {tokens ? (
          <MuxPlayer
            playbackId={tokens.playbackId}
            tokens={{
              playback: tokens.playback,
              thumbnail: tokens.thumbnail,
              storyboard: tokens.storyboard,
            }}
            streamType="on-demand"
            playsInline
            poster={poster}
            // The player's own controls carry the community's brand and are otherwise untouched:
            // they are keyboard-operable out of the box (UI-SPEC §Motion & Accessibility).
            accentColor="var(--brand-accent)"
            className="h-full w-full"
          />
        ) : null}
      </div>

      {refused ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={minting}
          onClick={() => void mint()}
        >
          {t('retry')}
        </Button>
      ) : null}
    </div>
  );
}
