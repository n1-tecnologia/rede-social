---
phase: 07-notifications-web-push-chat
reviewed: 2026-10-01T12:00:00Z
depth: standard
diff_base: 7b5981b
files_reviewed: 8
files_reviewed_list:
  - apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx
  - apps/web/e2e/admin.ts
  - apps/web/e2e/feed-comments.spec.ts
  - apps/web/e2e/feed.spec.ts
  - apps/web/e2e/fixtures.ts
  - apps/web/e2e/hosts.ts
  - apps/web/playwright.config.ts
  - apps/web/turbo.json
findings:
  critical: 0
  warning: 4
  info: 7
  total: 11
status: issues_found
---

# Phase 07: Code Review Report (gap closure 07-12..07-15)

This report replaces the earlier full-phase report at this path. That report (commit 45a7c86, plus the fixes recorded in 07-REVIEW-FIX.md) is still in git history.

**Reviewed:** 2026-10-01T12:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Scope: `git diff 7b5981b..HEAD` for the eight files listed above, which are the gap-closure plans 07-12 to 07-15. The changes cover the e2e harness platform host, the targeted comment-action failure helper, the FEED-04 like cases that restore their own like, the C-WR-03 race regressions on `/notificacoes`, and the turbo ordering of web `typecheck` after `build`.

Checks for the four requested risks:

- **Leaking `.env*` values:** none found. The new `console.warn` in `playwright.config.ts:44-46` prints only the harness hostname, never the value from the file. The new fixture helpers print nothing from `apps/api/.env.local`.
- **Scope of the fixture DB helpers:** correct. `clearFeedPostLike` deletes only where `post_id = $postId` and the user's e-mail is `$email`. `feedPostLikeState` reads only one post. The `feed_likes_post_uq` unique index and the `app.feed_like_count()` delete branch keep `like_count` consistent. The captions resolved by `feedPostIdFor` are unique per tenant in the local DB.
- **Turbo graph:** correct, with no cycle. The package override replaces the root `dependsOn`, `^build` is listed again, and Vercel's `turbo build` graph does not change. The cost of the new coupling is in IN-05.
- **Vacuous or weakened assertions:** four warnings. Two are e2e races the new code narrows but does not close (WR-01, WR-02). One is a harness override that silently does nothing when a server is reused (WR-03). One is a green unit case that certifies a state its own `it.fails` companion says has no basis (WR-04).

Cross-project interference on the shared member and posts is not possible: `workers: 1` and `fullyParallel: false` (`playwright.config.ts:72-73`) run the projects one after another. The positive control in case 3 of the notifications test (`flush()` is enough to see an appended page) means the "stale page dropped" assertion in case 1 does not pass just because it was checked too early.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: The hydration probe in `scrollFeedToBottom` does not guarantee that the `ScrollRoot` reset has already run

**File:** `apps/web/e2e/feed.spec.ts:68-78`
**Issue:** The fix waits until `main.app-scroll` carries a `__reactProps$…` key and then scrolls. React attaches that key while it hydrates the node, in the render/complete phase. That is *before* commit. `ScrollRoot`'s reset is a passive `useEffect` (`packages/core/ui/ScrollRoot.tsx:24-26`, `ref.current?.scrollTo({ top: 0 })`). `hydrateRoot` hydration runs in a concurrent lane, so passive effects are flushed in a later scheduler task, after commit. There is therefore still a window: the predicate is true, Playwright's `evaluate` scrolls to the bottom, and then the mount effect scrolls back to the top. This is the same race 05.3/07-13 recorded. It is narrower, but not closed, and it is most likely on a cold dev server, which is exactly where 07-13 reproduced it. The check also depends on React's private prop key.
**Fix:** Do not use the hydration marker as the readiness signal. Make the scroll self-verifying:
```ts
const root = page.locator('main.app-scroll');
await expect(async () => {
  await root.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  // one frame later the position must have held (the mount effect would have reset it)
  const held = await root.evaluate(
    (el) => new Promise<boolean>((r) => requestAnimationFrame(() => r(el.scrollTop > 0))),
  );
  expect(held).toBe(true);
}).toPass({ timeout: 30_000 });
```
Alternatively, have `ScrollRoot` set `data-scroll-ready` inside the effect, after its reset, and wait for that attribute.

### WR-02: The "one request" check in the double-tap case runs as soon as the first response arrives, so a later second toggle can slip through

**File:** `apps/web/e2e/feed.spec.ts:446-447` (with `155-161`, `467-478`)
**Issue:** `expect(likeRequests()).toBe(1)` runs right after `await liked`, the response to the *first* matching request. Suppose the double tap produces a second toggle that the like engine serialises behind the first, or that is sent a little later. That request is not counted yet. The DB check on the next line can also run before it commits. The later steps do not reliably catch it either: `page.reload()` can render before the late unlike lands, and the cleanup unlike is idempotent at the API, so the case can still end green with `liked:false, likeCount:0`. The listener added by `countPostRequests` stays active across the reload, but nothing reads it again before the cleanup click.
**Fix:** Read the counter again at the last point where only the gesture's requests can exist, which is just before the cleanup unlike is armed:
```ts
await page.reload();
// …assertions on the reloaded card…
expect(likeRequests()).toBe(1); // still one: no late second toggle reached the network
const unliked = nextPostResponse(page, galleryId);
```
You can also wait out the gesture window first (for example `await page.waitForTimeout(400)`, which is longer than `DoubleTapHeart`'s 300 ms) and only then assert the count and the DB state.

### WR-03: The PLATFORM_HOST override has no effect on reused servers, and the warning still says it does

**File:** `apps/web/playwright.config.ts:40-49` (with `98`, `105`)
**Issue:** Both `webServer` entries use `reuseExistingServer: true`. If a developer already has `pnpm --filter @rede-social/api dev` or `next dev` running, which is the normal local setup (the four-process Mux setup keeps the API up), Playwright does not spawn them. The `process.env.PLATFORM_HOST` the harness sets therefore never reaches them, and the servers keep the stale value from `.env.local`. At the same time the warning says *"this run serves the platform shell on <harness host>"*, which is false in this case. Every platform-host case then fails, and the one diagnostic line points away from the cause. `apps/api/.env.local` currently defines `PLATFORM_HOST` twice with different values, so which one a hand-started API uses depends on the parser.
**Fix:** Either word the warning so it covers this case, for example:
```ts
console.warn(
  `[e2e] servers this run STARTS serve the platform shell on ${harnessPlatformHost}; ` +
  `an already-running api/web (reuseExistingServer) keeps the PLATFORM_HOST from its .env.local — restart it or fix the file.`,
);
```
or, when the file value differs from the harness host, set `reuseExistingServer: false` for that run so the override reaches the servers.

### WR-04: Green case 2 asserts that row `b` "stays read" even though no read request for `b` is ever sent

**File:** `apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx:290-304`
**Issue:** The title says that rows tapped "during" a failed mark-all stay read, and the case asserts `row('b')` has `data-unread="false"` after the mark-all returns 500. In the product, `activate` sends a read POST only while the row looks unread (`NotificationsSurface.tsx:208-213`). Mark-all already cleared it, so tapping `b` sends **no** request. The mark-all also failed. The server therefore never marked `b` read. The UI shows it read, and the next refresh (`setLocallyRead(new Set())`) will show it unread again. The second `it.fails` documents exactly this missing premise. Even so, the green case passes today and certifies the inconsistent outcome as correct, and the product comment it relies on ("its own keepalive POST really marked it read", `NotificationsSurface.tsx:222-223`) is untrue at HEAD. If the gap is later fixed by rolling `b` back instead of sending its POST, this case turns red even though that fix is also valid.
**Fix:** Do not let the green case assert a client/server state that the companion `it.fails` says is unsupported. Either drop the `b` assertions from case 2 and keep them only in the gap case, or assert the actual HEAD behaviour so the divergence is visible:
```ts
// HEAD: `b` shows read but no read POST left for it (gap "own read POST" below).
expect(fetchMock).not.toHaveBeenCalledWith('/api/notifications/b/read', expect.anything());
```
Then flip both assertions together when the product is fixed.

## Info

### IN-01: `failedCount()` cannot detect over-matching, despite what its doc comment says

**File:** `apps/web/e2e/feed-comments.spec.ts:125-126, 136-141, 353, 382`
**Issue:** The handler stops failing requests once `failed` reaches `count`, so `failedCount()` can only be 0 or 1. If the matcher caught the wrong request first, the count is still 1. What actually turns the case red is the comment list loading successfully. The doc comment's claim that the counter alone shows "a matcher that … fails something else" is overstated.
**Fix:** Count every matching request separately from the failures, for example `matched += 1` before the `failed < count` check, and assert `matched === 1` before `restore()`.

### IN-02: `it.fails` passes on any thrown error, not only the documented gap

**File:** `apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx:367-395`
**Issue:** Both gap cases are intentional (WINDOWS 66/67). Even so, `it.fails` stays green for any throw: a renamed test id, a render crash, or a partial fix such as the read POST being sent without `keepalive`. The green cases above share the same selectors, which partly makes up for this.
**Fix:** Optionally, assert the current HEAD behaviour explicitly in a plain `it` (for example, `queryByTestId('notifications-mark-all')` is `null` during the POST), so a change for any other reason is noticed.

### IN-03: Case 2 still accepts "control withdrawn" as a pass

**File:** `apps/web/app/(app)/notificacoes/NotificationsSurface.test.tsx:287-288`
**Issue:** `expect(during === null || during.disabled).toBe(true)` is a deliberately weaker version of the UI-SPEC "aria-busy and disabled" rule. When gap E04 is fixed, the `it.fails` turns red, but this disjunction stays permissive.
**Fix:** In the same change that turns E04 into a plain `it`, tighten this line to `during?.disabled === true`.

### IN-04: The `hosts.ts` "read at call time" rationale does not hold for the config path

**File:** `apps/web/e2e/hosts.ts:9-10`, `apps/web/playwright.config.ts:41`
**Issue:** The base config calls `e2ePlatformHostname()` when it is imported. `playwright.pwa.config.ts` imports it on line 3 and changes the URLs only on lines 24-27, so the PWA run takes its PLATFORM_HOST from the URL as it was before that change. This works only because the hostname (`rede-social.localhost`) is the same on both ports. If the PWA config ever changes the hostname, the server host and the browsed host will quietly differ.
**Fix:** Move the PWA URL changes before the base import, using a small `pwa-env.ts` imported first, or make the base config compute PLATFORM_HOST inside a function that the PWA config calls after making its changes.

### IN-05: A mismatched exported PLATFORM_HOST is silent

**File:** `apps/web/playwright.config.ts:40`
**Issue:** An exported value always wins with no message. A stale value left in a developer's shell, for example from direnv or `source .env.local`, then produces the same platform-host failures 07-12 fixed, with no diagnostic.
**Fix:** Keep the rule that an exported value wins, but warn without printing the value: `if (exportedPlatformHost !== undefined && exportedPlatformHost !== e2ePlatformHostname()) console.warn('[e2e] exported PLATFORM_HOST differs from the host the specs browse (<harness host>)')`.

### IN-06: `typecheck` now requires a full production build of web

**File:** `apps/web/turbo.json:14-16`
**Issue:** The comment covers the slower root `pnpm typecheck`, but two more effects are not mentioned. (1) `next build` validates `@t3-oss/env` at build time, so `turbo run typecheck` now fails without `API_URL` and `NEXT_PUBLIC_SUPABASE_*`, for reasons that have nothing to do with types. (2) A web build failure now stops typecheck from running, so its diagnostics disappear behind the build error.
**Fix:** Accept and document both effects in the comment, or separate the outputs instead of ordering the tasks (for example, run `next typegen` into its own directory, or pin the race by having `build` own typegen) so `typecheck` can depend only on `^build`.

### IN-07: The like matcher is looser than the comment matcher, and a diagnostic probe was left in the spec

**File:** `apps/web/e2e/feed.spec.ts:150-152, 424-464`
**Issue:** `carriesPost` matches any POST whose body contains the post id. Unlike `failNextActions`, it does not require the `next-action` header, so any future non-action POST that carries the id would count as a like and could resolve `nextPostResponse` early. Separately, the `__doubleTapProbe` capture listener and its annotation are investigation scaffolding that every run carries.
**Fix:** Add `&& request.headers()['next-action'] !== undefined` to `carriesPost`. Remove the probe, or gate it behind an env flag, once the timing question it was added for is answered.

---

_Reviewed: 2026-10-01T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
