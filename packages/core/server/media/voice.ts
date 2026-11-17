import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { VOICE_MAX_SECONDS } from '@rede-social/contracts/media';

/**
 * The worker's half of a voice message (12.5-02, D-847, D-848, D-863; VOICE-14..17): ONE hostile
 * recording in, ONE mono AAC `audio/mp4` file with the index at the front and an exact duration out.
 *
 * WHY NORMALIZE. A browser's MediaRecorder writes WebM or fragmented MP4 with no duration and no seek
 * index, and iOS before 18.4 cannot play WebM at all. Storing the take as recorded would make the bar
 * and seeking depend on `audio.duration` (Infinity for a live WebM). One server-side format fixes
 * playback, seeking and the stored duration for every client.
 *
 * HOSTILE INPUT. The bytes come from a member's browser and reach a native demuxer and decoder, so the
 * child process is boxed in (T-12.5-05): `execFile` with an argument ARRAY (no shell, no
 * interpolation), `-nostdin`, `-protocol_whitelist file` (no network protocol can be named by a
 * playlist inside the file), the demuxer and the decoder PINNED from the declared mime (the request
 * path already checked the signature matches it) so ffmpeg never probes, only the first audio stream
 * is mapped, a 20 second kill, an output size cap, a per-job `mkdtemp` directory removed in `finally`.
 * The binaries are resolved from PATH; nothing here reads an environment variable.
 *
 * ERRORS ARE OF TWO KINDS. `VoiceNormalizeError` is the file's fault (undecodable, no audio stream,
 * too long): the worker marks the row `rejected` and does not retry. Anything else (the binary is
 * missing, the process timed out) is thrown as a plain error so the job's bounded retry and its
 * terminal `failed` state apply unchanged.
 */

export const VOICE_FFMPEG_TIMEOUT_MS = 20_000;
/**
 * `-t` on the output: the read and the decode stop after 302 s of audio, so a six-hour file costs the
 * same as a five-minute one. It is one second above the verdict on purpose: a 400 s upload yields 302 s,
 * which is judged too long, instead of being truncated to a value that would pass.
 */
export const VOICE_INPUT_LIMIT_SECONDS = 302;
/** The recorder stops at 300 s but is not sample-exact and AAC adds priming; 301 is the verdict line. */
export const VOICE_REJECT_ABOVE_SECONDS = 301;
/** `-fs`: the output is 48 kbit/s mono, so 302 s is about 1.8 MB; this is a ceiling, not an estimate. */
export const VOICE_OUTPUT_MAX_BYTES = 8_000_000;

export const VOICE_NORMALIZE_REASONS = ['transcode_failed', 'duration_too_long'] as const;
export type VoiceNormalizeReason = (typeof VOICE_NORMALIZE_REASONS)[number];

export class VoiceNormalizeError extends Error {
  readonly reason: VoiceNormalizeReason;
  constructor(reason: VoiceNormalizeReason, message?: string) {
    super(message ?? `voice rejected: ${reason}`);
    this.name = 'VoiceNormalizeError';
    this.reason = reason;
  }
}

export type VoiceNormalized = {
  /** The one `audio/mp4` object to store over the `original` key. */
  body: Buffer;
  /** The stored duration: the measured value rounded and clamped to 1..VOICE_MAX_SECONDS. */
  durationSeconds: number;
};

const DEMUXERS: Record<string, string> = {
  'audio/webm': 'matroska',
  'audio/mp4': 'mov',
  'audio/ogg': 'ogg',
};

const DECODERS: Record<string, string> = {
  'audio/webm': 'opus',
  'audio/mp4': 'aac',
  'audio/ogg': 'opus',
};

/** The ffmpeg demuxer a declared mime pins; an unlisted mime is the file's fault. */
export function voiceDemuxerFor(mime: string): string {
  const demuxer = Object.hasOwn(DEMUXERS, mime) ? DEMUXERS[mime] : undefined;
  if (!demuxer) throw new VoiceNormalizeError('transcode_failed', `no demuxer for ${mime}`);
  return demuxer;
}

/** The ffmpeg decoder a declared mime pins (Opus for WebM and Ogg, AAC for MP4). */
export function voiceDecoderFor(mime: string): string {
  const decoder = Object.hasOwn(DECODERS, mime) ? DECODERS[mime] : undefined;
  if (!decoder) throw new VoiceNormalizeError('transcode_failed', `no decoder for ${mime}`);
  return decoder;
}

/** The whole ffmpeg argument vector for one take. An array on purpose: it never meets a shell. */
export function buildNormalizeArgs(mime: string, inPath: string, outPath: string): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-v',
    'error',
    '-protocol_whitelist',
    'file',
    '-f',
    voiceDemuxerFor(mime),
    '-c:a',
    voiceDecoderFor(mime),
    '-i',
    inPath,
    '-vn',
    '-sn',
    '-dn',
    '-map',
    '0:a:0',
    '-map_metadata',
    '-1',
    '-t',
    String(VOICE_INPUT_LIMIT_SECONDS),
    '-c:a',
    'aac',
    '-b:a',
    '48k',
    '-ac',
    '1',
    '-ar',
    '44100',
    '-movflags',
    '+faststart',
    '-fs',
    String(VOICE_OUTPUT_MAX_BYTES),
    '-f',
    'mp4',
    '-y',
    outPath,
  ];
}

/**
 * The verdict on the OUTPUT's measured duration. Above 301 s is `duration_too_long` (never truncated
 * into a pass, see `VOICE_INPUT_LIMIT_SECONDS`); NaN and anything not positive means ffmpeg produced
 * nothing usable, which is `transcode_failed`. An accepted value is rounded and clamped to 1..300.
 */
export function judgeVoiceDuration(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new VoiceNormalizeError('transcode_failed');
  if (seconds > VOICE_REJECT_ABOVE_SECONDS) throw new VoiceNormalizeError('duration_too_long');
  return Math.min(VOICE_MAX_SECONDS, Math.max(1, Math.round(seconds)));
}

const execFileP = promisify(execFile);

const EXEC_OPTIONS = {
  timeout: VOICE_FFMPEG_TIMEOUT_MS,
  killSignal: 'SIGKILL',
  maxBuffer: 1 << 20,
} as const;

type ExecFailure = Error & { code?: string | number; killed?: boolean; signal?: string | null };

/**
 * Splits a child-process failure into the two kinds this file promises: a missing binary or a timeout
 * is INFRASTRUCTURE (rethrown as is, the job retries), a non-zero exit is the FILE (the take cannot be
 * decoded).
 */
function failureOf(error: unknown, tool: string): Error {
  const failure = error as ExecFailure;
  if (failure.code === 'ENOENT') return new Error(`${tool} is not installed on this machine`);
  if (failure.killed || failure.signal === 'SIGKILL') {
    return new Error(`${tool} was killed after ${VOICE_FFMPEG_TIMEOUT_MS} ms`);
  }
  if (typeof failure.code === 'number') {
    return new VoiceNormalizeError('transcode_failed', `${tool} exited with ${failure.code}`);
  }
  return failure instanceof Error ? failure : new Error(String(error));
}

async function probeDuration(path: string): Promise<number> {
  try {
    const { stdout } = await execFileP(
      'ffprobe',
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file',
        '-show_entries',
        'format=duration',
        '-of',
        'json',
        path,
      ],
      EXEC_OPTIONS,
    );
    const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
    return Number.parseFloat(parsed.format?.duration ?? '');
  } catch (error) {
    if (error instanceof SyntaxError) throw new VoiceNormalizeError('transcode_failed');
    throw failureOf(error, 'ffprobe');
  }
}

/**
 * Normalizes one take. `mime` is the DECLARED mime the request path already matched to the signature.
 * Throws `VoiceNormalizeError` for the file's fault, a plain `Error` for the machine's.
 */
export async function normalizeVoice(input: Buffer, mime: string): Promise<VoiceNormalized> {
  const dir = await mkdtemp(join(tmpdir(), 'voice-'));
  try {
    const inPath = join(dir, 'in');
    const outPath = join(dir, 'out.mp4');
    await writeFile(inPath, input);
    try {
      await execFileP('ffmpeg', buildNormalizeArgs(mime, inPath, outPath), EXEC_OPTIONS);
    } catch (error) {
      throw failureOf(error, 'ffmpeg');
    }
    const body = await readFile(outPath).catch(() => null);
    if (!body || body.length === 0) throw new VoiceNormalizeError('transcode_failed');
    const durationSeconds = judgeVoiceDuration(await probeDuration(outPath));
    return { body, durationSeconds };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
