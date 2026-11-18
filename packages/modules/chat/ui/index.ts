/**
 * `@rede-social/module-chat/ui`: the only surface `apps/web` may import from this module's UI.
 * Props-only components, no words (the host passes every string from the `chat` catalog).
 * May import `@rede-social/ui`, `@rede-social/core/ui` and `@rede-social/contracts` only (MOD-02).
 */
export {
  CHAT_COMPOSER_COUNTER_FROM,
  CHAT_COMPOSER_MAX_LENGTH,
  ChatComposer,
  type ChatComposerProps,
  type ChatComposerVoice,
} from './ChatComposer';
export { DaySeparator, type DaySeparatorProps } from './DaySeparator';
export { InboxRow, type InboxRowProps, type InboxRowState } from './InboxRow';
export {
  MessageBubble,
  type MessageBubbleLabel,
  type MessageBubbleProps,
  type MessageBubbleTextProps,
  type MessageBubbleVoice,
  type MessageBubbleVoiceDeleted,
  type MessageBubbleVoiceFailed,
  type MessageBubbleVoicePending,
  type MessageBubbleVoicePlayer,
  type MessageBubbleVoiceProps,
  type MessageBubbleVoiceReady,
} from './MessageBubble';
export { MessageList, type MessageListItem, type MessageListProps } from './MessageList';
export {
  ThreadHeader,
  type ThreadHeaderMemberProps,
  type ThreadHeaderProps,
  type ThreadHeaderStaffProps,
} from './ThreadHeader';
export {
  classifyVoiceError,
  type UseVoiceRecorderOptions,
  useVoiceRecorder,
  VOICE_MAX_SECONDS_DEFAULT,
  VOICE_MIN_SECONDS_DEFAULT,
  VOICE_RECORDER_INITIAL,
  VOICE_WARN_AT_SECONDS_DEFAULT,
  type VoiceProblem,
  type VoiceRecorderApi,
  type VoiceRecorderEvent,
  type VoiceRecorderPhase,
  type VoiceRecorderState,
  type VoiceStopReason,
  type VoiceTake,
  voiceRecorderReducer,
} from './useVoiceRecorder';
export {
  VoicePlayer,
  VoicePlayerGhost,
  type VoicePlayerGhostProps,
  type VoicePlayerLabels,
  type VoicePlayerProps,
} from './VoicePlayer';
export { pauseAllVoice } from './voice-playback-controller';
