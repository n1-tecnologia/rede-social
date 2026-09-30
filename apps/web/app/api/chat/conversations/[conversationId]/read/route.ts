import { readInputSchema } from '@rede-social/module-chat/contracts';
import { ApiClientError } from '@/lib/bootstrap';
import { markConversationRead } from '@/lib/chat';
import { empty, NOTIFICATION_ID_RE, sameOrigin } from '@/lib/notifications-bff';
import { createClient } from '@/lib/supabase/server';

/**
 * `POST /api/chat/conversations/{id}/read { seq }` (07-09, D-237, UI-D-261): the thread pane's read
 * mark, sent after mount and after each append from the other side while the document is visible, with
 * `fetch(…, { keepalive: true })` so it outlives a navigation away (a server action could not promise
 * that). It clears the member's dot, or the awaiting state for the whole team. The page's GET render
 * records nothing (prefetch-safe, the 06-06 rule).
 *
 * Gates, in order, each refusal costing ZERO API calls (T-07-63, cloned from `lib/notifications-bff`):
 *  1. **Same origin (403):** a route handler gets none of the Origin check Next gives Server Actions.
 *  2. **A canonical uuid path id (400).**
 *  3. **A declared body over 256 bytes (413).**
 *  4. **A verified session (401)** through `getClaims()` (JWKS).
 *  5. **The body (413 / 400):** read as text, capped at 256 bytes, parsed as JSON and validated with
 *     the chat contract's `readInputSchema` (`{ seq: int >= 0 }`, strict). Only `seq` is forwarded.
 *  6. **Forward ONCE (204)**, answering the API's 4xx verbatim (a foreign id is its bare 404) or 502.
 * Logs carry the shape only.
 */
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  if (!sameOrigin(request)) return empty(403);
  const { conversationId } = await params;
  if (!NOTIFICATION_ID_RE.test(conversationId)) return empty(400);

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) return empty(413);

  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims) return empty(401);

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return empty(413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return empty(400);
  }
  const input = readInputSchema.safeParse(parsed);
  if (!input.success) return empty(400);

  try {
    await markConversationRead(conversationId.toLowerCase(), input.data.seq);
    return empty(204);
  } catch (error) {
    const status = error instanceof ApiClientError ? error.status : null;
    console.error('chat.read_failed', {
      status,
      code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
    });
    return empty(status !== null && status >= 400 && status < 500 ? status : 502);
  }
}
