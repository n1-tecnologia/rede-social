import { progressBodySchema } from '@rede-social/module-courses/contracts';
import { z } from 'zod';
import { putLessonProgress } from '@/lib/courses-learn';
import { createClient } from '@/lib/supabase/server';

/**
 * `POST /api/courses/progress` — the page-hide twin of `saveProgressAction` (08.5-08, D-427,
 * UI-D-433, R-Don't Hand-Roll; threat T-08.5-08). A clone of `/api/stories/views` (T-05.2-57).
 *
 * WHY it exists: when the member leaves the lesson, the player has one last position to keep, and a
 * server action is a plain `fetch` the browser may abort on unload. `LessonPlayer` posts it here with
 * `navigator.sendBeacon` on `pagehide`, which the browser delivers after the page is gone. This
 * handler turns the session cookie into the Bearer the API verifies, exactly like the action does.
 * The beacon ignores the answer, so every answer is an empty body with `cache-control: no-store`.
 *
 * The gates, in order — each refusal costs ZERO API calls:
 *  1. **Same origin (403).** A route handler gets NONE of the Origin check Next gives Server Actions,
 *     and the session rides in a cookie, so a cross-site form post would otherwise write progress as
 *     the member. The Origin must be present, not the literal `null`, and its host (port included)
 *     must equal the browser-facing host — `x-forwarded-host` first, `host` second (proxy.ts).
 *  2. **A declared body over 4 KiB (413)** — the real body is about 80 bytes.
 *  3. **A verified session (401)** — `getClaims()` checks the signature via JWKS; the API re-verifies
 *     the Bearer anyway.
 *  4. **The body (413 / 400)** — read as text (the beacon sends `text/plain`), capped at 4 KiB, parsed
 *     as a JSON object; `lessonId` must be a uuid and `positionSeconds` must pass the SAME strict
 *     `progressBodySchema` the action and the API use (an integer 0–14400).
 *  5. **Forward ONCE (204)** through `putLessonProgress` → `apiFetch` (Bearer + `x-tenant-host`).
 *     Only `{ positionSeconds }` is ever forwarded — never `completed`, never the raw body: a beacon
 *     cannot press "Marcar como concluída". A refusal is logged by SHAPE only (status and code, never
 *     an id or a position — V8) and answered with its status (403 / 409 lock, 404 gone, 401 for a
 *     session refusal), or 502 for anything else.
 */
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4096;

const empty = (status: number) =>
  new Response(null, { status, headers: { 'cache-control': 'no-store' } });

const lessonIdSchema = z.uuid();

/** The browser-facing host, lower-cased — `x-forwarded-host` first, the proxy.ts precedence. */
function browserHost(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwarded || request.headers.get('host');
  return host ? host.toLowerCase() : null;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const host = browserHost(request);
  return host !== null && originHost === host;
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return empty(403);

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return empty(413);

  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims) return empty(401);

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return empty(413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return empty(400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return empty(400);
  const fields = body as { lessonId?: unknown; positionSeconds?: unknown };
  const lessonId = lessonIdSchema.safeParse(fields.lessonId);
  if (!lessonId.success) return empty(400);
  const progress = progressBodySchema.safeParse({ positionSeconds: fields.positionSeconds });
  if (!progress.success || progress.data.positionSeconds === undefined) return empty(400);

  const outcome = await putLessonProgress(lessonId.data, {
    positionSeconds: progress.data.positionSeconds,
  });
  if (outcome.status === 'ok') return empty(204);

  let status: number;
  let code: string;
  switch (outcome.status) {
    case 'locked':
      status = outcome.reason === 'purchase' ? 403 : 409;
      code = outcome.reason === 'purchase' ? 'lesson_locked' : 'lesson_sequence_locked';
      break;
    case 'not_found':
    case 'disabled':
      status = 404;
      code = outcome.status === 'disabled' ? 'MODULE_DISABLED' : 'NOT_FOUND';
      break;
    case 'redirect':
      status = 401;
      code = 'SESSION_REFUSED';
      break;
    default:
      status =
        outcome.httpStatus !== null && outcome.httpStatus >= 400 && outcome.httpStatus < 500
          ? outcome.httpStatus
          : 502;
      code = outcome.code;
  }
  console.error('courses.progress_beacon_failed', { status, code });
  return empty(status);
}
