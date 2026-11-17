/**
 * Feature detection for the voice recorder (UI-D-841, A-UI-6). It only READS what the browser offers: it never
 * asks for the microphone, so it is safe to run after mount on every page load. The permission request itself
 * lives in `useVoiceRecorder`, inside the tap handler of the microphone and nowhere else.
 *
 * Kept apart from the hook so the recorder file names the capture call exactly once (its start function).
 */
export function isVoiceRecordingSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (window.isSecureContext === false) return false;
  if (typeof MediaRecorder === 'undefined') return false;
  return typeof navigator.mediaDevices?.getUserMedia === 'function';
}
