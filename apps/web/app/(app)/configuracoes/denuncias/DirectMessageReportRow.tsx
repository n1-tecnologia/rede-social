'use client';

import { VoicePlayer } from '@rede-social/module-chat/ui';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import {
  formatVoiceDuration,
  nextPlaybackRate,
  playbackRateLabel,
  spokenVoiceDuration,
} from '@/lib/chat-view';
import type { ReportBodyView } from '@/lib/reports-view';

/** The three bodies of a reported direct message (D-731, UI-D-873). */
export type DirectMessageBody = Extract<
  ReportBodyView,
  { kind: 'message' | 'voice' | 'voiceGone' }
>;

export interface DirectMessageReportRowProps {
  body: DirectMessageBody;
  /**
   * The media-link requester: the path the player hands its audio element on the FIRST tap (nothing loads before).
   * It is built from the report's own `voice.mediaId` and from nothing else, and the media gate answers it only for
   * the report's readers (D-731); a refused link is the player's own error state with retry. The screen never
   * computes who may hear the recording (UI-D-881).
   */
  mediaSrc: (mediaId: string) => string;
}

/**
 * What a reported direct message looks like in the administrator's queue (MODER-05, D-731, D-732, UI-D-873): the
 * message ALONE.
 *
 * - **Text:** the whole stored copy (at most 280 characters), `whitespace-pre-wrap`, NO clamp (the administrator
 *   judges the message on its own words), as React text and never a link.
 * - **Voice:** the shipped Phase 12.5 `VoicePlayer` (the other side's look, 280px, the speed pill) with its own idle,
 *   loading, playing and error states.
 * - **Voice, recording gone:** "Mensagem de voz apagada" and no player.
 * - Under each, the one line "Só esta mensagem é mostrada." (12/400 tertiary).
 *
 * There is NO anchor in this component, and no conversation name, counterpart or neighbouring message: the row view
 * carries none (T-11-09), and a test asserts the output has no `<a>`.
 */
export function DirectMessageReportRow({ body, mediaSrc }: DirectMessageReportRowProps) {
  const t = useTranslations('chat');
  const [rateNote, setRateNote] = useState<{ count: number; text: string }>({ count: 0, text: '' });

  let content: ReactNode;
  if (body.kind === 'message') {
    content =
      body.text === '' ? null : (
        <p
          data-report-message-text
          className="max-w-full self-start whitespace-pre-wrap break-words rounded-2xl rounded-bl-md border border-border bg-bg-secondary px-3 py-2 text-sm font-normal leading-normal text-text [overflow-wrap:anywhere]"
        >
          {body.text}
        </p>
      );
  } else if (body.kind === 'voiceGone') {
    content = (
      <p
        data-report-voice-gone
        className="max-w-full self-start rounded-2xl rounded-bl-md border border-border bg-bg-secondary px-3 py-2 text-sm font-normal leading-normal text-text-secondary"
      >
        {body.text}
      </p>
    );
  } else {
    content = (
      // biome-ignore lint/a11y/useSemanticElements: a fieldset brings legend and min-width quirks into a bubble; UI-D-855 prescribes role="group"
      <div
        role="group"
        data-report-voice
        aria-label={t('voice.group', { spoken: spokenVoiceDuration(body.durationSeconds, t) })}
        className="w-70 max-w-full self-start rounded-2xl rounded-bl-md border border-border bg-bg-secondary px-3 py-2 text-sm font-normal leading-normal text-text"
      >
        <VoicePlayer
          src={mediaSrc(body.mediaId)}
          durationSeconds={body.durationSeconds}
          own={false}
          labels={{
            play: t('voice.player.play'),
            pause: t('voice.player.pause'),
            loading: t('voice.player.loading'),
            retry: t('thread.retry'),
            seek: t('voice.player.seek'),
            error: t('voice.player.error'),
            unsupported: t('voice.player.unsupported'),
            speed: (rate: string) => t('voice.player.speed', { rate }),
            seekValue: (current: string, total: string) =>
              t('voice.player.seekValue', { current, total }),
          }}
          formatClock={formatVoiceDuration}
          nextRate={(rate: number) => nextPlaybackRate(rate)}
          rateLabel={(rate: number) => playbackRateLabel(rate, t)}
          onRateChange={(label: string) =>
            setRateNote((before) => ({
              count: before.count + 1,
              text: t('voice.live.rate', { rate: label }),
            }))
          }
        />
        <span aria-live="polite" className="sr-only">
          {rateNote.text}
        </span>
      </div>
    );
  }

  return (
    <div data-report-message={body.kind} className="flex flex-col gap-2">
      {content}
      <p data-report-message-note className="text-xs font-normal text-text-tertiary">
        {body.note}
      </p>
    </div>
  );
}
