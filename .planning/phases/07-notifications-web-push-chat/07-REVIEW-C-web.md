---
phase: 07-notifications-web-push-chat
area: C (apps/web)
reviewed: 2026-10-01T00:30:31Z
depth: standard
diff_base: 80ef5b8
files_reviewed: 69
files_reviewed_list:
  - apps/web/.env.example
  - apps/web/app/(app)/configuracoes/page.tsx
  - apps/web/app/(app)/inicio/page.tsx
  - apps/web/app/(app)/layout.tsx
  - apps/web/app/(app)/notificacoes/NotificationsSurface.tsx
  - apps/web/app/(app)/notificacoes/actions.ts
  - apps/web/app/(app)/notificacoes/loading.tsx
  - apps/web/app/(app)/notificacoes/page.tsx
  - apps/web/app/(app)/post/[postId]/page.tsx
  - apps/web/app/(app)/suporte/SupportInbox.tsx
  - apps/web/app/(app)/suporte/SupportSplit.tsx
  - apps/web/app/(app)/suporte/ThreadPane.tsx
  - apps/web/app/(app)/suporte/[conversationId]/loading.tsx
  - apps/web/app/(app)/suporte/[conversationId]/not-found.tsx
  - apps/web/app/(app)/suporte/[conversationId]/page.tsx
  - apps/web/app/(app)/suporte/actions.ts
  - apps/web/app/(app)/suporte/layout.tsx
  - apps/web/app/(app)/suporte/loading.tsx
  - apps/web/app/(app)/suporte/page.tsx
  - apps/web/app/api/chat/conversations/[conversationId]/messages/route.ts
  - apps/web/app/api/chat/conversations/[conversationId]/read/route.ts
  - apps/web/app/api/chat/inbox/route.ts
  - apps/web/app/api/me/counters/route.ts
  - apps/web/app/api/notifications/[notificationId]/read/route.ts
  - apps/web/app/api/notifications/read-all/route.ts
  - apps/web/app/api/notifications/seen/route.ts
  - apps/web/app/api/push/subscriptions/route.test.ts
  - apps/web/app/api/push/subscriptions/route.ts
  - apps/web/app/api/realtime/token/route.test.ts
  - apps/web/app/api/realtime/token/route.ts
  - apps/web/app/sw.ts
  - apps/web/components/feedback/NoticeToast.tsx
  - apps/web/components/push/PushControls.tsx
  - apps/web/components/pwa/InstallHint.test.ts
  - apps/web/components/pwa/InstallHint.tsx
  - apps/web/components/shell/LiveShell.tsx
  - apps/web/components/shell/LogoutForm.tsx
  - apps/web/e2e/blocked.spec.ts
  - apps/web/e2e/chat-admin.ts
  - apps/web/e2e/chat.spec.ts
  - apps/web/e2e/media-video.spec.ts
  - apps/web/e2e/notifications-admin.ts
  - apps/web/e2e/notifications.spec.ts
  - apps/web/e2e/phase7-smoke.spec.ts
  - apps/web/e2e/profile.spec.ts
  - apps/web/e2e/push-fake.ts
  - apps/web/e2e/push.spec.ts
  - apps/web/e2e/shell.spec.ts
  - apps/web/i18n/messages.test.ts
  - apps/web/lib/chat-view.test.ts
  - apps/web/lib/chat-view.ts
  - apps/web/lib/chat.ts
  - apps/web/lib/env.ts
  - apps/web/lib/feed.ts
  - apps/web/lib/notification-renderers.tsx
  - apps/web/lib/notifications-bff.ts
  - apps/web/lib/notifications-view.test.ts
  - apps/web/lib/notifications-view.ts
  - apps/web/lib/notifications.ts
  - apps/web/lib/push-sw.test.ts
  - apps/web/lib/push-sw.ts
  - apps/web/lib/push.test.ts
  - apps/web/lib/push.ts
  - apps/web/lib/registry.tsx
  - apps/web/messages/pt-BR/chat.json
  - apps/web/messages/pt-BR/feed.json
  - apps/web/messages/pt-BR/notifications.json
  - apps/web/messages/pt-BR/pwa.json
  - apps/web/package.json
findings:
  critical: 1
  warning: 6
  info: 8
  total: 15
status: issues_found
---

# Phase 7: Code Review Report, Area C (apps/web)

**Reviewed:** 2026-10-01T00:30:31Z
**Depth:** standard (Phase 7 diff `80ef5b8..HEAD`)
**Files Reviewed:** 69
**Status:** issues_found

## Summary

I reviewed the Phase 7 web layer: the BFF route handlers (realtime token, counters, notification marks, chat catch-up/read/inbox, push subscriptions), the service worker push listeners and `lib/push-sw.ts`, the client push flow (`lib/push.ts`, `PushControls`, `LiveShell`, `LogoutForm`), the `/notificacoes` and `/suporte` surfaces, and the e2e/unit specs. I also cross-checked the kernel helpers they call (`BeforeLogout`, `useRealtimeTopic`, `InfiniteScroll`, `app-badge`) and the server rules that the web code depends on: gapless chat `seq`, push-subscription upsert/replace, `requireModule('notifications')`, and the `blocked_at` predicate in the realtime RLS.

The security gates hold up. Each POST BFF checks Origin against the host, and each GET checks Sec-Fetch-Site. Path ids are uuid-checked before any request is built. Bodies are size-capped and validated against the contract schema. The service worker only follows same-origin paths when a notification is clicked (`resolveClickUrl` rejects `//`, `/\`, whitespace and absolute URLs), and `focusOrOpen` never touches a window from another origin. Notification hrefs are built from `encodeURIComponent` path segments. Chat and notification text reaches React only as text nodes or next-intl values, with no `dangerouslySetInnerHTML`. I found no XSS, no open redirect and no cross-tenant path.

The serious problem is correctness in the chat pane. The catch-up cursor (`lastSeqRef`) can jump over a message from the other side, and that message is then dropped for the rest of the session. The warnings cover: push surfaces that are not gated on the `notifications` module, the fetch-metadata gate cutting off older Safari, paging races in the notifications list, a read mark that is never retried, a push-state check that can stay on "checking" forever, and a push subscription that outlives the session when the member does not use "Sair".

## Critical Issues

### C-CR-01: The chat catch-up cursor skips messages, so a reply from the other side is lost for the session

**File:** `apps/web/app/(app)/suporte/ThreadPane.tsx:174-175, 238-249, 263, 354`
**Issue:** `lastSeqRef` serves as both the catch-up cursor and the replay filter, and three code paths can move it past a seq the pane never received:

1. **Send resolves before the other side's signal arrives.** Staff reply at seq N, then the member's message is stored at seq N+1. The send action returns `view.seq = N+1`, line 354 sets `lastSeqRef = N+1`, and the next render (line 175) recomputes it as the max of `views`, which is also N+1. When the Realtime signal for N lands (the Broadcast trigger is often slower than the action's HTTP response), `onSignal` drops it as a replay (`seq <= lastSeqRef.current`, line 263). Every later catch-up asks for `afterSeq=N+1`, so N is never fetched. Refocus and re-subscribe call the same `catchUp`, so they cannot recover it either. Only a full reload shows the message.
2. **A catch-up is in flight when the send resolves.** `catchUp` requested `afterSeq=N-1` and gets back `[N, N+1]`. Meanwhile `onSend` has already raised `lastSeqRef` to N+1. Line 241 then filters `item.seq > lastSeqRef.current`, which removes N even though it was fetched.
3. The same thing happens to staff when two agents and the member write at the same moment, because a staff reply also goes through `onSend`.

`seq` is gapless per conversation (`service.ts`: "the database assigns the next gapless `seq`"), so a gap means a missing message. Support replies vanish without any error. That breaks CHAT-04 / D-240 ("never lose a message; the catch-up recovers missed signals").

**Fix:** Keep a catch-up cursor that only `catchUp` moves forward, and deduplicate by id instead of by the moving max:
```tsx
const caughtUpRef = useRef(initialViews.reduce((m, v) => Math.max(m, v.seq), 0)); // only catchUp advances it

// catchUp loop
const after = caughtUpRef.current;
const answer = await fetchPage(id, `afterSeq=${after}`);
if (!answer) break;
const known = new Set(settledOf(viewsRef.current).map((v) => v.id));
const fresh = answer.items.filter((item) => !known.has(item.id));
if (answer.items.length > 0) {
  caughtUpRef.current = Math.max(after, ...answer.items.map((i) => i.seq));
}
// ...merge fresh (mergeViews already dedups by id)

// onSignal: compare against caughtUpRef, not the max of views
if (typeof seq === 'number' && seq <= caughtUpRef.current) return;

// onSend success: merge the own view, but do NOT touch the catch-up cursor;
// if view.seq > caughtUpRef.current + 1, there is a gap, so run catch-up
if (view.seq > caughtUpRef.current + 1) void catchUp();
else caughtUpRef.current = Math.max(caughtUpRef.current, view.seq);
```
Add a unit or e2e case for this: member sends while a staff reply's signal is delayed or dropped, and the staff reply must still appear.

## Warnings

### C-WR-01: Push surfaces and `/notificacoes` ignore the `notifications` module toggle (tenant without the module gets an OS prompt and then a guaranteed failure)

**Files:** `apps/web/app/(app)/configuracoes/page.tsx:153-158`, `apps/web/app/(app)/layout.tsx:96-106`, `apps/web/app/(app)/notificacoes/page.tsx:36-91`, `apps/web/app/(app)/notificacoes/NotificationsSurface.tsx:186-187`
**Issue:** The API mounts `/v1/notifications/*`, including `/push-subscriptions`, behind `requireModule('notifications')` (`packages/modules/notifications/server/routes.ts:37`). The web side does not check the module before showing push UI:
- `PushSettingRow` renders for every tenant member (`platform ? null : …`). On a tenant without notifications (rede-lab), tapping the switch shows the browser's permission prompt. The member grants it, the subscription is created, the BFF POST returns 404 `MODULE_DISABLED`, `enablePush` unsubscribes, and the error toast fires. The member has now given the origin push permission for nothing, and that permission stays.
- `LiveShell` gets `vapidPublicKey` without checking `notificationsEnabled`, so `syncPushOnOpen` POSTs to a 404 on every app open.
- `/notificacoes` has no module gate. Compare `reels/page.tsx:42`, which calls `notFound()`. The page renders the error card plus the soft-ask card, and `NotificationsSurface` joins `tenant:<t>:all` without a condition. `LiveShell` deliberately skips that topic when the module is off ("the database would refuse it anyway, and a refused channel only costs retries").

**Fix:** Compute `const notificationsOn = bootstrap.modules.some((m) => m.key === 'notifications')` once. Pass `vapidPublicKey={notificationsOn ? env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null : null}` to `LiveShell`, render `PushSettingRow` only when it is on (or show the `unsupported` row), and call `notFound()` at the top of `NotificationsPage` when it is off.

### C-WR-02: Requiring `Sec-Fetch-Site` breaks every GET BFF route on browsers that do not send fetch metadata (Safari/iOS < 16.4)

**Files:** `apps/web/app/api/realtime/token/route.ts:25`, `apps/web/app/api/me/counters/route.ts:22`, `apps/web/app/api/chat/inbox/route.ts:26`, `apps/web/app/api/chat/conversations/[conversationId]/messages/route.ts:47`
**Issue:** `request.headers.get('sec-fetch-site') !== 'same-origin'` returns 403 when the header is missing. WebKit only began sending `Sec-Fetch-*` in Safari 16.4. On iOS 15 through 16.3, a large share of a mobile-first pt-BR audience, all four routes refuse every request. As a result:
- Realtime never connects (the token route returns 403).
- Live counters never refresh.
- The chat pane's "Carregar mensagens anteriores" always fails, and the catch-up never runs. The thread freezes at its server render.
- The staff inbox never refreshes.

This is not limited to push, which those versions lack anyway: it removes basic chat function. The gate also adds little security for these GETs. A cross-origin page cannot read a same-origin JSON response without CORS headers, and a JSON object is not useful when loaded as a `<script>`.

**Fix:** Refuse only on positive evidence that the request is cross-site, and fall back to the Origin check when the header is absent:
```ts
const site = request.headers.get('sec-fetch-site');
if (site !== null && site !== 'same-origin') return empty(403);
if (site === null) {
  const origin = request.headers.get('origin');
  if (origin !== null && !sameOrigin(request)) return empty(403);
}
```
Put this in one shared helper next to `sameOrigin` in `lib/notifications-bff.ts`.

### C-WR-03: Notifications list paging has no generation guard, so a pull-to-refresh during a load-more splices stale pages in, and mark-all failure discards taps made meanwhile

**File:** `apps/web/app/(app)/notificacoes/NotificationsSurface.tsx:218-236, 241-265, 267-286`
**Issue:**
- `loadMore` captures `unreadCursor`/`readCursor` from its closure. If a pull (`refresh`) finishes while a load-more is in flight, `refresh` resets `unread`/`unreadCursor` to a fresh page 1. The stale load-more then appends the page after the old cursor and replaces `unreadCursor` with that page's next cursor. Rows between the new page 1's end and the old cursor never show up (a gap), and paging continues from the stale position. The same applies to the `read` branch: `setRead(page.items)` can overwrite a refreshed Anteriores page.
- `markAll` stores `before = locallyRead` when the POST starts. On failure, `setLocallyRead(before)` throws away any ids tapped during the request. Those rows were really marked read by their own keepalive POSTs, but they show as unread again.

**Fix:** Add a `generationRef` that `refresh` increments. Have `loadMore` capture it at the start and drop its result when it no longer matches. For mark-all, restore only the ids the optimistic step added:
```ts
const added = [...everything].filter((id) => !before.has(id));
setLocallyRead((cur) => { const next = new Set(cur); for (const id of added) next.delete(id); return next; });
```

### C-WR-04: A failed chat read mark is never retried, so the dot or "awaiting" state stays despite the comment

**File:** `apps/web/app/(app)/suporte/ThreadPane.tsx:201-217`
**Issue:** `readSeqRef.current = seq` is set before the POST. The rollback is inside `.catch`, which only runs on a network rejection. A 502 from the BFF (transient API failure), a 401 or a 429 all resolve the fetch with `res.ok === false`, so `readSeqRef` stays at `seq`. Later calls on refocus (line 280) and on the next catch-up then see `seq <= readSeqRef.current` and return early. The comment says "A failed mark is retried by the next append or refocus: the dot simply stays", but refocus never retries. The member's dot, or the staff team's "awaiting" flag, stays set until the other side writes again.
**Fix:**
```ts
void fetch(url, init)
  .then((res) => { if (!res.ok) throw new Error(String(res.status)); })
  .catch(() => { readSeqRef.current = Math.min(readSeqRef.current, seq - 1); });
```

### C-WR-05: The push state can stay on "checking" forever when the service worker never activates

**Files:** `apps/web/components/push/PushControls.tsx:63-68`, `apps/web/lib/push.ts:272-279`
**Issue:** `usePushDevice` awaits `pushRegistration()`, which is `navigator.serviceWorker.ready` with no time limit. `ready` never resolves if registration failed. The registration uses `type: 'module'` (`ServiceWorkerRegister.tsx:40`), which browsers without module-worker support reject. It can also fail on a script error, under some enterprise policies, or in `next dev` before the worker installs. In any of these cases the Configurações row stays in `checking` with no way out, and the soft-ask never decides. `pushRegistrationWithin()` already exists for logout but is not used here.
**Fix:** Use a bounded wait for the mount-time read too, and treat a timeout as `unsupported`:
```ts
void pushRegistrationWithin(5000).then(async (reg) => { ... });
```
`readPushState(null, …)` already returns `'unsupported'` for a null registration.

### C-WR-06: Pushes for the previous member keep arriving on a shared device after any sign-out other than "Sair"

**Files:** `apps/web/components/shell/LiveShell.tsx:107-109`, `apps/web/components/shell/LogoutForm.tsx:23-26`, `apps/web/app/(app)/actions.ts:18-29`
**Issue:** The device's subscription is only forgotten in the "Sair" `onSubmit` path (T-07-45). It survives when the session ends any other way: refresh-token expiry or revocation, a global sign-out from another device, or `/entrar` after cookies are cleared. In those cases the browser keeps member A's subscription, and the server row still belongs to A, so A's notification titles and bodies keep appearing on a device where nobody is signed in. The row is only reassigned when someone else signs in and `syncPushOnOpen` re-saves it. Blocked members are covered on the server by the live-membership predicate, but these other cases are not. Separately, when `logout()` itself fails (`?erro=sair`), push has already been disabled without the member being told.
**Fix:** On the signed-out entry surfaces (`/entrar` and `/acesso-suspenso`, client-side on mount), call `disablePush(await pushRegistrationWithin())` if a subscription exists. The DELETE will 401 without a session, but the browser-side `unsubscribe()` is what stops delivery, and the server drops the row on the next 404/410. Also call `navigator.clearAppBadge?.()` there (see C-IN-05).

## Info

### C-IN-01: The `push-received` postMessage has no listener

**File:** `apps/web/app/sw.ts:125-127`
**Issue:** When a push is suppressed in the foreground, the worker posts `{ type: 'push-received', tag }` to every window, but nothing in `apps/web` or `packages` listens for it (grep finds no consumer). The foreground signal is effectively Realtime alone. Either remove the loop or add a listener that triggers the counters refetch, so a foreground push still updates the badge when Realtime is disconnected.

### C-IN-02: Gate helpers and uuid regexes are copied in several places

**Files:** `apps/web/app/api/push/subscriptions/route.ts:33-53` (copies `empty`/`browserHost`/`sameOrigin` from `lib/notifications-bff.ts`), `apps/web/app/api/me/counters/route.ts:18`, `apps/web/app/(app)/suporte/actions.ts:120` and `apps/web/app/(app)/suporte/[conversationId]/page.tsx:14` (two copies of `CONVERSATION_ID_RE`). The chat routes import `NOTIFICATION_ID_RE` to validate conversation ids.
**Issue:** These are security gates. Several copies will drift, and the 413 checks already differ: `read/route.ts` fails closed on a NaN `content-length`, `push/subscriptions` does not. **Fix:** Move them into one `lib/bff-gates.ts` (`empty`, `sameOrigin`, `sameSiteGet`, `UUID_RE`) and import from there.

### C-IN-03: The notifications live merge runs as a server action, against the codebase's own rule

**File:** `apps/web/app/(app)/notificacoes/NotificationsSurface.tsx:157`
**Issue:** `mergeLatest` calls `refreshNotificationsAction` on every signal, re-join and refocus. The counters, chat and inbox code all say realtime-triggered refetches must be GET route handlers because Next runs a page's server actions one at a time. Here a live merge can wait behind a load-more, or a load-more behind a merge. A refusal inside the action also `redirect()`s the page from a background signal. **Fix:** Add `GET /api/notifications?section=unread` with the same gates as `/api/chat/inbox`, and keep the server action for user-paced paging only.

### C-IN-04: ThreadPane has one scroll-intent slot, so a concurrent catch-up can overwrite the history anchor

**File:** `apps/web/app/(app)/suporte/ThreadPane.tsx:171, 246, 297`
**Issue:** `loadOlder` writes `{kind:'anchor'}` and `catchUp` writes `{kind:'keep'}` to the same `intentRef`. When both state updates land in one React batch, the anchor is lost and prepended history jumps the viewport. **Fix:** Compose the intents (the anchor wins over keep), or apply the anchor offset directly in the same layout effect pass.

### C-IN-05: The app icon badge is not cleared on logout

**Files:** `apps/web/components/shell/LiveShell.tsx:107-109`, `apps/web/components/shell/LogoutForm.tsx:23-25`
**Issue:** The badge is set by `LiveCountersProvider` and by the worker (`setAppBadge(payload.badge)`), but `forgetDevice` never clears it. On a shared installed PWA, the previous member's unread count stays on the icon. **Fix:** Call `navigator.clearAppBadge?.().catch(() => {})` inside `forgetDevice`.

### C-IN-06: Chat runs group staff by first name only

**File:** `apps/web/lib/chat-view.ts:128`
**Issue:** `authorKey: 'staff:' + firstName` puts two agents with the same first name into one run, so the time and grouping are wrong. In the staff view, a colleague with the viewer's first name and the viewer's own bubbles ("Você") can join one run on the same side. **Fix:** Add an opaque per-author key to the row contract (for example a hashed author id the API already knows) and group by that. D-222 forbids exposing ids in the view, so the key must be opaque.

### C-IN-07: Fixed sleeps in Phase 7 e2e specs make tests flaky

**Files:** `apps/web/e2e/chat.spec.ts:203, 214, 221, 275, 538, 603, 722`, `apps/web/e2e/phase7-smoke.spec.ts:210, 348, 375, 388`, `apps/web/e2e/push.spec.ts:191, 225, 272`, `apps/web/e2e/notifications.spec.ts:456`
**Issue:** Line 203 in `chat.spec.ts` ("The pane joins its conversation topic before the drop starts") waits a fixed 2 s for subscription readiness. On a slow CI runner the drop can start before the join and the test passes or fails for the wrong reason. Several absence assertions also rely on fixed sleeps. **Fix:** Expose a `data-realtime-state="joined"` attribute (or a test hook) and wait on it, and assert absence after a positive marker rather than after `waitForTimeout`.

### C-IN-08: `enablePush` replaces a rotated-key subscription without deleting its server row, and calls `sameKey` twice

**File:** `apps/web/lib/push.ts:160-165`
**Issue:** When the existing subscription was made with another VAPID key, it is unsubscribed locally but its server row stays until the first send returns 410. `syncPushOnOpen` (lines 242-245) does the same. `sameKey` also runs twice on the same inputs. **Fix:** Compute `const reuse = existing && sameKey(existing, vapidKey)` once. When `existing && !reuse`, also send a best-effort `DELETE` for `existing.endpoint` before re-subscribing.

---

_Reviewed: 2026-10-01T00:30:31Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
