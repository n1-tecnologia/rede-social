---
phase: 04-feed
part: C
scope: apps/web
reviewed: 2026-09-23T00:00:00Z
depth: standard
files_reviewed: 40
files_reviewed_list:
  - apps/web/app/(app)/criar/ComposerForm.tsx
  - apps/web/app/(app)/criar/actions.ts
  - apps/web/app/(app)/criar/page.tsx
  - apps/web/app/(app)/inicio/feed-actions.ts
  - apps/web/app/(app)/post/[postId]/editar/page.tsx
  - apps/web/app/(app)/post/[postId]/loading.tsx
  - apps/web/app/(app)/post/[postId]/not-found.tsx
  - apps/web/app/(app)/post/[postId]/page.tsx
  - apps/web/app/(auth)/entrar/actions.ts
  - apps/web/app/globals.css
  - apps/web/components/feed/FeedSurface.tsx
  - apps/web/components/feed/PostDetail.tsx
  - apps/web/components/feed/useDeletePost.ts
  - apps/web/components/feed/useSharePost.ts
  - apps/web/components/media/MediaImage.tsx
  - apps/web/components/media/useSignedUpload.ts
  - apps/web/e2e/admin.ts
  - apps/web/e2e/feed-admin.ts
  - apps/web/e2e/feed-comments.spec.ts
  - apps/web/e2e/feed-composer.spec.ts
  - apps/web/e2e/feed-media.spec.ts
  - apps/web/e2e/feed-share.spec.ts
  - apps/web/e2e/feed.spec.ts
  - apps/web/e2e/fixtures.ts
  - apps/web/e2e/fixtures/README.md
  - apps/web/e2e/phase2-smoke.spec.ts
  - apps/web/e2e/phase4-smoke.spec.ts
  - apps/web/e2e/platform-domains.spec.ts
  - apps/web/e2e/platform-tenants.spec.ts
  - apps/web/e2e/shell.spec.ts
  - apps/web/e2e/tenant-fixtures.ts
  - apps/web/lib/continue-path.ts
  - apps/web/lib/feed-view.tsx
  - apps/web/lib/feed-write.ts
  - apps/web/lib/feed.ts
  - apps/web/lib/registry.tsx
  - apps/web/lib/tenant-host.ts
  - apps/web/messages/pt-BR/feed.json
  - apps/web/package.json
  - apps/web/proxy.ts
findings:
  critical: 1
  warning: 11
  info: 10
  total: 22
status: issues_found
---

# Phase 04 (Part C — `apps/web`): Code Review Report

**Reviewed:** 2026-09-23
**Depth:** standard
**Files Reviewed:** 40
**Status:** issues_found

## Summary

Part C covers the Next.js web tier: the BFF fetch layer (`lib/feed.ts`), the server actions, the
composer, the post route, the proxy, the post-login continue-path mechanism, and the Playwright
suite.

The architectural rules hold up under inspection: there is exactly one `apiFetch`
(`apps/web/lib/api.ts:26`, no second definition anywhere in `apps/web`); `lib/feed.ts` is the single
feed fetch implementation and every action and page goes through it; the data mappings are in
`feed-view.tsx` and the label blocks in `registry.tsx` with no cycle; no `'use server'` module
re-exports another; every user-visible string in the reviewed files resolves through
`messages/pt-BR/feed.json`; and no debug artefact, `as any`, `innerHTML`, `eval` or hardcoded secret
appears in the app code.

**The `continue-path` audit comes back mostly clean.** `safeContinuePath` is applied at USE (in the
login action), not only at write; it rejects `//host`, `/\host`, non-`/` prefixes, control
characters and >512 chars, and then re-runs the `/post/[^/]+$` predicate, so a forged cookie cannot
steer a login anywhere except one same-origin post route. The cookie is host-scoped (no `Domain`
attribute) and tenants live on distinct hosts, so it cannot survive a tenant switch; the alias→primary
308 in `primaryHostRedirect` runs *before* the auth bounce, so the cookie is only ever written on the
primary origin. I found **no open-redirect and no cross-tenant path**. The one real defect on that
surface is the missing `Secure` attribute (C-WR-01), which deviates from the project's own
`sessionCookieOptions` policy.

The one blocking defect is elsewhere and is exactly the failure mode the feed code documents itself
against: `homeSlotsFor` wraps the slot renderers in `Promise.allSettled`, which swallows the
`NEXT_REDIRECT` throw `loadFeed()` deliberately raises for every refusal `bootstrapRedirectPath`
knows.

### Cross-partition dependencies (stated, not reviewed)

- **Optimistic like rollback / sentinel error state.** `likePostAction` and `loadMoreFeedAction`
  return closed result objects; whether a rejected page leaves the sentinel spinning and whether a
  rejected like restores the exact pre-click pair is decided inside `@rede-social/module-feed/ui`
  (`FeedList`, `PostCard`) — **Part A**. Note that these server actions can also *reject* (transport
  failure, or `redirect()` for a known refusal), not only resolve to `{ ok: false }`; the module must
  handle both.
- **`useDeletePost` throws `Error('post_delete_refused')` on any refusal** (`useDeletePost.ts:45`).
  That rejection is load-bearing (it is what keeps the card on screen), but nothing in `apps/web`
  catches it: `PostDetail.confirmDelete` awaits and lets it propagate into `PostMenu`'s handler.
  Whether `PostMenu`/`FeedList` catch it or leak an unhandled promise rejection is **Part A**.
- **Gallery ordering.** `postMediaView`/`composerDraft` rely on `GET /v1/feed` returning
  `post.media` already in `position` order (the contract at
  `packages/modules/feed/contracts/index.ts:374` promises it). See C-WR-04 — **Part B** owns the
  `ORDER BY`.
- **Server-action id re-checking.** Every id-taking action validates a uuid and then leans on the
  API's own predicate (`author_user_id`, tenant scope, asset ownership per T-04-56). That is the
  correct division; the API half is **Part B**.

---

## Critical Issues

### C-CR-01: `homeSlotsFor` swallows the feed's refusal redirect with `Promise.allSettled`

**File:** `apps/web/lib/registry.tsx:296-305` (with `apps/web/lib/feed.ts:79-91`)

**Issue:** `loadFeed()` is written specifically so that a refusal becomes a *navigation*:

```ts
// lib/feed.ts:84-89
} catch (error) {
  if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
  ...
}
if (path) redirect(path);      // deliberately OUTSIDE the try/catch
```

and its docblock says so verbatim: *"A refusal `bootstrapRedirectPath` knows … becomes a navigation,
performed OUTSIDE the try/catch: `redirect()` throws in Next 16 and a catch would swallow it."*

`feedHome` (the only consumer) is then invoked by `homeSlotsFor` through:

```ts
// lib/registry.tsx:296-299
const [te, results] = await Promise.all([
  getTranslations('app.error'),
  Promise.allSettled(jobs.map((job) => job.run())),
]);
```

`Promise.allSettled` is a `catch` by another name. Next 16's `redirect()` signals by throwing an
error carrying the `NEXT_REDIRECT` digest; `allSettled` converts it into a `rejected` result, which
`homeSlotsFor` then renders as the generic `EmptyState` error card (`registry.tsx:304-320`) and
logs as `home-slot.failed`.

Consequence: when `GET /v1/feed` answers `401`, `MEMBERSHIP_BLOCKED`, `TENANT_SUSPENDED`,
`TENANT_HOST_MISMATCH`, `MEMBERSHIP_INVITED` or `NO_MEMBERSHIP` on `/inicio`, the member is **not**
sent to `/entrar`, `/auth/blocked`, `/auth/suspended`, `/auth/host-mismatch`, `/aceitar-convite` or
`/sem-comunidade`. They stay on `/inicio` looking at "Algo deu errado". `requireBootstrap()` runs
first and catches the common cases, so the window is the race between the bootstrap call and the
feed call (token expiring mid-render, a membership blocked or a tenant suspended between the two
requests, a host-mismatch answer that only the feed route produces). That window is precisely the
one the `redirect()`-outside-the-catch rule exists to close, and it is closed in every other caller
(`loadPost`, `loadPostComments`, `loadPage`, `toggle`, `commentPage` — all called directly, not
through `allSettled`).

**Fix:** re-throw Next's control-flow errors before treating a rejection as a slot failure.

```ts
import { unstable_rethrow } from 'next/navigation';

return results.map((result, i) => {
  const { key, order } = jobs[i] as (typeof jobs)[number];
  if (result.status === 'fulfilled') return { key, order, node: result.value };
  // NEXT_REDIRECT / NEXT_NOT_FOUND are control flow, not a slot failure: a refusal
  // `bootstrapRedirectPath` mapped must still navigate (lib/feed.ts).
  unstable_rethrow(result.reason);
  console.error('home-slot.failed', { slot: key, reason: String(result.reason) });
  return { key, order, node: (<EmptyState … />) };
});
```

(If `unstable_rethrow` is undesirable, check the digest explicitly:
`if (typeof reason?.digest === 'string' && reason.digest.startsWith('NEXT_')) throw reason;`.)

---

## Warnings

### C-WR-01: the continue cookie (and `tenant_slug`) are written without `Secure`

**File:** `apps/web/proxy.ts:218-223` (and `apps/web/proxy.ts:199-204`)

**Issue:** the project's own cookie policy is explicit —
`apps/web/lib/supabase/cookie-options.ts` sets `secure: process.env.NODE_ENV === 'production'` and
documents why. The two cookies `proxy.ts` writes by hand do not:

```ts
response.cookies.set(CONTINUE_COOKIE, path, {
  maxAge: CONTINUE_MAX_AGE_S,
  sameSite: 'lax',
  path: '/',
  httpOnly: true,            // no `secure`
});
```

In production over HTTPS, a cookie without `Secure` is sent on any plaintext request to the tenant
host and — more importantly — can be **set** by a network attacker on a plaintext response and will
then be presented to the HTTPS origin. `safeContinuePath` contains the blast radius (the attacker
can only force the post-login landing onto one same-origin `/post/{something}`, and in V1 only the
tenant admin can author posts), which is why this is a Warning rather than Critical — but it is an
auth-adjacent cookie introduced by this phase that silently opts out of the policy the session
cookies follow. `TENANT_SLUG_COOKIE` (pre-existing, same file, one-year lifetime) has the same gap.

**Fix:**

```ts
// proxy.ts — reuse the one policy rather than restating three attributes twice
import { sessionCookieOptions } from '@/lib/supabase/cookie-options';

response.cookies.set(CONTINUE_COOKIE, path, {
  maxAge: CONTINUE_MAX_AGE_S,
  sameSite: 'lax',
  path: '/',
  httpOnly: true,
  secure: sessionCookieOptions.secure,
});
```

Apply the same to `TENANT_SLUG_COOKIE` at line 199.

### C-WR-02: multi-select past `FEED_MAX_IMAGES` uploads every file and silently discards the surplus

**File:** `apps/web/app/(app)/criar/ComposerForm.tsx:216-229` (`pickImages`/`onImageInput`) and
`ComposerForm.tsx:213-228` (`imageUpload.onCompleted`)

**Issue:** the photo input is `multiple`, and `onImageInput` hands **every** selected file to
`pickImages`, which awaits a full `useSignedUpload.pick()` per file — browser re-encode, signed-URL
broker call, direct upload to Storage, `complete`. The cap is only applied afterwards, inside the
state updater:

```ts
setImages((previous) =>
  previous.length >= FEED_MAX_IMAGES ? previous : [...previous, { … }],
);
```

An admin who picks 15 photos in one file-chooser answer therefore pays 15 uploads, consumes 15
assets' worth of tenant storage quota, and sees 10 thumbnails with **no message at all** explaining
where the other five went. The five surplus `media_assets` rows are orphaned (`ready`, referenced by
no post). The disabled-picker guard (`images.length >= FEED_MAX_IMAGES`) only helps between
separate picks, not within one.

**Fix:** clamp before uploading and tell the admin when the selection was truncated.

```ts
const onImageInput = (event: ChangeEvent<HTMLInputElement>) => {
  const picked = Array.from(event.target.files ?? []);
  event.target.value = '';
  const room = Math.max(0, FEED_MAX_IMAGES - images.length);
  if (picked.length > room) {
    setMediaError(t('composer.errors.tooManyImages', { limit: FEED_MAX_IMAGES }));
  }
  const files = picked.slice(0, room);
  if (files.length > 0) void pickImages(files);
};
```

(`pickImages` should additionally re-read the cap between iterations, since `onCompleted` runs
between awaits.)

### C-WR-03: the composer falls through to `createPostAction` when `mode === 'edit'` without a `postId`

**File:** `apps/web/app/(app)/criar/ComposerForm.tsx:329-332`

**Issue:**

```ts
const result =
  mode === 'edit' && postId
    ? await updatePostAction(postId, body.data)
    : await createPostAction(body.data);
```

`postId` is optional in `ComposerFormProps`, so `mode: 'edit'` without it is representable. In that
case the body was built by `updatePostSchema` (it always carries
`videoAssetId: video?.assetId ?? null`, and `linkPreviewId: null` when the link row was dismissed)
and is then sent to `createPostAction`, whose `createPostSchema` is `.strict()` with
`videoAssetId: z.uuid().optional()` — **not** nullable. The parse always fails, so the admin gets
"Não foi possível publicar. Revise os campos e tente novamente." on a *save* they never asked to
publish. The route (`post/[postId]/editar/page.tsx:49`) always passes `postId` today, so this is
latent; it should not be representable.

**Fix:** make the prop shape a discriminated union so the compiler rejects the missing id:

```ts
export type ComposerFormProps =
  | { mode: 'create'; postId?: never; initial?: never }
  | { mode: 'edit'; postId: string; initial: ComposerDraft };
```

and branch on `mode` alone in `submit` and in `close`/`onConfirm` (`ComposerForm.tsx:271`, `813`).

### C-WR-04: gallery order is never enforced, only inherited from the API's `ORDER BY`

**File:** `apps/web/lib/feed-view.tsx:110-124` and `apps/web/lib/feed-view.tsx:248-264`

**Issue:** the docblock claims *"the gallery in `position` order"*, but neither `postMediaView` nor
`composerDraft` sorts. They `filter` and rely entirely on the API's projection order. `PostMediaItem`
carries `position` (`packages/modules/feed/contracts/index.ts:90`) precisely so the consumer does not
have to trust the row order.

This is worse on the edit path than on the read path. `composerDraft` builds `images` in whatever
order arrived; the composer then sends `imageAssetIds` back and the API assigns
`position = i` (contracts line 107: *"The arrays' ORDER IS THE GALLERY ORDER"*). So if the API's
order ever stops matching `position` — a `join` reordering, a planner change, a future `order by
created_at` — an admin opening the edit screen and pressing "Salvar alterações" without touching
anything **silently permutes the published gallery**. The `dirty` check at `ComposerForm.tsx:212`
would not even mark the form dirty, because it compares index-wise against the same scrambled
`initial`.

**Fix:** one line in each mapper.

```ts
const byPosition = (a: PostMediaItem, b: PostMediaItem) => a.position - b.position;
const images = post.media.filter((i) => i.kind === 'image').sort(byPosition);
// …and the same for the `file` filter in both postMediaView and composerDraft.
```

### C-WR-05: object URLs leak on every failed image upload and on unmount

**File:** `apps/web/app/(app)/criar/ComposerForm.tsx:109-110, 124-126, 128-129, 238-245`

**Issue:** `onPicked` creates an object URL and parks it in `pendingPreview.current`; only
`onCompleted` claims and clears it. Every path where `pick()` fails *after* `onPicked` — a refused
`startMediaUploadAction`, a failed transfer, a failed `completeMediaUploadAction`, a cancel — leaves
the URL alive and unreferenced; the next `onPicked` overwrites the ref and the previous blob is
retained for the life of the document. Separately, `removeImage` is the **only** place that calls
`URL.revokeObjectURL`, so every preview still on screen when the admin publishes, discards or
navigates away is retained.

**Fix:** revoke on the failure paths and on unmount.

```ts
const clearPendingPreview = useCallback(() => {
  if (pendingPreview.current) URL.revokeObjectURL(pendingPreview.current);
  pendingPreview.current = null;
}, []);

// in useSignedUpload's option surface, add an onFailed/onSettled hook that calls clearPendingPreview()
useEffect(() => () => {
  clearPendingPreview();
  for (const image of imagesRef.current) {
    if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
  }
}, [clearPendingPreview]);
```

### C-WR-06: the "nobody has touched this post" assertion also passes on a post with exactly one like

**File:** `apps/web/e2e/feed.spec.ts:289`

**Issue:**

```ts
await expect(meta).not.toContainText(likeSegment(0).replace('0 ', ''));
```

`likeSegment(0)` is `"0 curtidas"`; stripping `"0 "` leaves `"curtidas"`. The assertion is therefore
"the meta row does not contain the word *curtidas*". A card carrying exactly one like renders
`"1 curtida"` (singular), which does **not** contain `"curtidas"` — so the precondition passes on a
dirty seed, and the very next assertion (`toContainText(likeSegment(1))`) then passes for the wrong
reason: the like the test just performed made the count 2, and "2 curtidas" contains "1 curtida"?
No — but the *starting* state being 1 rather than 0 is exactly what this guard is meant to rule out
and it does not. Given C-WR-07 (a failed run leaves the seed liked), this is the guard that would
have caught the pollution and it is the one that is wrong.

**Fix:** assert the absence of any like segment, positively:

```ts
const anyLikeSegment = /\d+\s+curtidas?/;
await expect(meta).not.toHaveText(anyLikeSegment);
```

### C-WR-07: mutation-and-undo in the e2e suite is not in a `finally`, so one failure permanently poisons the shared seed

**Files:** `apps/web/e2e/feed.spec.ts:291-305, 316-329`;
`apps/web/e2e/feed-comments.spec.ts:180-196, 213-228, 241-258, 360-382`

**Issue:** these tests all follow the shape *mutate the shared seeded tenant → assert → undo at the
end of the test body*. The undo is a plain statement, not a `finally`. Any failing assertion in
between aborts the test and the mutation stays: a like left set on `firstFiller`/`galleryCaption`, a
comment left on the first seeded post, a soft-delete stamp left on a lab post.

That matters because other assertions in the same suite read those exact values as constants.
`feed-comments.spec.ts:190` hardcodes the post's comment count:

```ts
const twoComments = F.meta.comments.other.replace('{count}', '3');
```

One orphaned comment makes it 4 and that test fails forever, on every subsequent run, until someone
re-seeds by hand. `feed.spec.ts` likewise asserts `seededFeedPaging.total` (27) exactly.
`feed-share.spec.ts:137-149` is the one place that *does* get this right (its
`setFeedPostRemoved(labPostId, false)` is in a `finally`) — the pattern exists in the file set, it is
just not applied.

**Fix:** wrap each mutate/undo pair.

```ts
await card.getByRole('button', { name: F.actions.like }).click();
try {
  await expect(card.getByRole('button', { name: F.actions.unlike })).toBeVisible();
  await expect(meta).toContainText(likeSegment(1));
  await page.reload();
  …
} finally {
  const back = cardWith(page, seededFeedPaging.firstFiller)
    .getByRole('button', { name: F.actions.unlike });
  if (await back.count()) await back.click();
}
```

and derive the expected comment count from the observed `metaBefore` rather than hardcoding `3`.

### C-WR-08: the new e2e teardown helpers delete more than the spec created

**File:** `apps/web/e2e/admin.ts:481-486` (`deleteFeedPostsLike`),
`apps/web/e2e/admin.ts:512-520` (`deletePostAssetsSince`), used from
`apps/web/e2e/feed-composer.spec.ts:70, 85-89`

**Issue:** three problems in one teardown.

1. `deleteFeedPostsLike(prefix)` runs
   `delete from public.feed_posts where caption like ${prefix + '%'}` with **no tenant scope** and
   **no LIKE-wildcard escaping**. A prefix containing `_` or `%` (none today) silently widens the
   match, and the statement is free to delete matching posts in any tenant.
2. `deletePostAssetsSince('rede-demo', startedAt)` is called with
   `const startedAt = new Date()` evaluated at **module scope** (`feed-composer.spec.ts:70`).
   Playwright imports every spec file during collection, before the first test runs, so `startedAt`
   is effectively "the start of the whole run". The teardown therefore deletes **every** `post`/
   `attachment` media asset created in `rede-demo` during the entire run — including assets created
   by any other spec that executed earlier in the same run.
3. Unlike `deleteTenantVideoAssets` (which was amended in this very phase to detach
   `feed_post_media` first, `admin.ts:262-268`), `deletePostAssetsSince` deletes `media_assets`
   directly. If any `feed_posts` row created during the run still references one of those assets —
   any post not matching `PREFIX`, i.e. anything a future spec publishes — the delete raises a
   foreign-key violation and the whole `afterAll` throws.

**Fix:**

```ts
// capture the window when the tests start, not when the module is imported
let startedAt: Date;
test.beforeAll(() => { startedAt = new Date(); });

// admin.ts — scope the post delete to a tenant
export async function deleteFeedPostsLike(prefix: string, tenantSlug: string): Promise<number> {
  const removed = await sql()`
    delete from public.feed_posts p
     using public.tenants t
     where t.id = p.tenant_id and t.slug = ${tenantSlug}
       and p.caption like ${`${prefix.replace(/[%_\\]/g, '\\$&')}%`} escape '\\'
    returning p.id`;
  return removed.length;
}

// admin.ts — detach before deleting, exactly as deleteTenantVideoAssets does
await sql()`delete from public.feed_post_media m using public.media_assets a, public.tenants t
            where m.media_asset_id = a.id and a.tenant_id = t.id and t.slug = ${tenantSlug}
              and a.purpose in ('post','attachment') and a.created_at >= ${since.toISOString()}::timestamptz`;
```

### C-WR-09: hardcoded password literal in the Phase 4 smoke spec

**File:** `apps/web/e2e/phase4-smoke.spec.ts:65`

**Issue:**

```ts
const OFF_PASSWORD = 'Segredo123';
```

This literal is then used to create two real GoTrue users
(`createEmptyFeedTenant(slug, OFF_PASSWORD)` → `admin/users` with `email_confirm: true`) and to log
in through the UI. Every other fixture in the suite reads `SEED_PASSWORD` from the environment, with
an explicit comment at `fixtures.ts:3` — *"Passed on the command line, never stored."* —
and `feed.spec.ts:405` provisions the same kind of throwaway tenant with `SEED_PASSWORD`. This is
the only credential literal in the file set and it trips the standard secret-scan pattern.

**Fix:** use the same source the rest of the suite uses.

```ts
import { SEED_PASSWORD } from './fixtures';
// …
off = await createEmptyFeedTenant(slug, SEED_PASSWORD);
```

and replace the six `OFF_PASSWORD` call sites.

### C-WR-10: dead `postgres` client and a stale docblock left behind in `phase2-smoke.spec.ts`

**File:** `apps/web/e2e/phase2-smoke.spec.ts:113-121` and `:364`

**Issue:** `setTenantModuleFlag` was lifted out of this file into `tenant-fixtures.ts`, and it was
the module-level `sql` client's only consumer (`grep` confirms `sql` now appears exactly twice:
its declaration and `await sql.end()`). What remains is a dead connection pool plus a docblock that
still describes a module this phase deleted:

```ts
/**
 * Spec-only superuser connection … It exists for ONE write: flipping the reference module of the
 * THROWAWAY tenant.
 */
const sql = postgres(process.env.PLAYWRIGHT_DB_URL ?? '…', { prepare: false, max: 1 });
```

A future reader following that comment will look for a reference module that no longer exists
(D-19). The `postgres` import becomes unused once the constant goes.

**Fix:** delete lines 113-121, the `await sql.end();` at line 364 and the now-unused
`import postgres from 'postgres'`.

### C-WR-11: hard `waitForTimeout` is the only synchronisation for the sentinel's request-count assertions

**File:** `apps/web/e2e/feed.spec.ts:217, 231`

**Issue:** the paging test establishes its baseline with `await page.waitForTimeout(1_000)` (waiting
for the video card's playback-token action to settle) and proves "no third request" with
`await page.waitForTimeout(500)`. Both are wall-clock guesses against a dev server. On a loaded CI
machine the 1 s baseline can be taken *before* the playback-token POST lands, which then counts as
the sentinel's page and makes `expect(actionPosts() - base).toBe(1)` fail with a spurious 2 — the
one assertion in the file that cannot be retried into passing, since `retries: 0`.

**Fix:** poll for quiescence instead of guessing.

```ts
// baseline: wait until the action count stops moving, not for a fixed second
let last = -1;
await expect.poll(() => { const now = actionPosts(); const stable = now === last; last = now; return stable; },
  { timeout: 10_000 }).toBe(true);
const base = actionPosts();
```

and for the "no third request" case, assert the count stays put across an
`expect.poll(...).toBe(2)` window rather than after a 500 ms sleep.

---

## Info

### C-IN-01: the tenant time zone is a hardcoded constant in a multi-tenant product

**File:** `apps/web/lib/feed-view.tsx:39`
**Issue:** `const TENANT_TIME_ZONE = 'America/Sao_Paulo';` — documented as a stand-in until the
bootstrap carries `tenants.timezone`, but it is a per-tenant fact frozen into a shared module, and
absolute timestamps on every card and comment render in it regardless of tenant.
**Fix:** thread it through the same way `now`, `tf` and `shareOrigin` already are (a parameter from
the caller, defaulting to the constant) so the day the bootstrap gains the field the change is one
call site per surface, not a grep.

### C-IN-02: a dynamic catalog key makes a new link-preview provider a crash rather than a degradation

**File:** `apps/web/lib/feed-view.tsx:165-167`
**Issue:** `tf(\`linkPreview.provider.${post.linkPreview.provider}\`)`. The catalog carries exactly
`youtube` and `vimeo`, and `LINK_PREVIEW_PROVIDERS` matches today, so this is safe — but next-intl
throws on a missing message during server rendering, so the day the API learns a third provider the
feed home slot and `/post/[id]` throw instead of rendering the card without a provider label. It also
defeats `scripts/check-ui-literals.sh`-style static key auditing.
**Fix:** switch exhaustively on the closed union, or guard with `tf.has(key)`.

### C-IN-03: `revalidatePath` inside the delete `try` can report a failure for a post that was deleted

**File:** `apps/web/app/(app)/inicio/feed-actions.ts:206-219`
**Issue:** `softDeletePost` runs, then two `revalidatePath` calls, and only then `result = { ok: true }`
— all inside the same `try`. A throw from `revalidatePath` lands in the catch as `generic`,
`useDeletePost` raises the error toast and rejects, and `FeedList` keeps a card whose post is gone.
`updatePostAction:181-187` already does this correctly (revalidation *after* the write helper, outside
its try).
**Fix:** set `result = { ok: true }` immediately after `softDeletePost` resolves and move the two
`revalidatePath` calls below the `catch`, guarded by `result.ok`.

### C-IN-04: every 404 maps to `not_found`, including `MODULE_DISABLED`

**File:** `apps/web/lib/feed-write.ts:51-53`
**Issue:** `if (error.status === 404) return 'not_found';` runs before the envelope's `code` is read.
A `404 MODULE_DISABLED` (feed flag flipped off while the composer was open — a state
`phase4-smoke.spec.ts:169-178` proves is reachable) tells the admin "Esta publicação não existe mais."
about a post they are creating.
**Fix:** `if (error.status === 404 && error.code !== 'MODULE_DISABLED') return 'not_found';`, and let
`MODULE_DISABLED` fall through to `generic` (or gain its own catalog key).

### C-IN-05: `URL.revokeObjectURL` is a side effect inside a `setState` updater

**File:** `apps/web/app/(app)/criar/ComposerForm.tsx:239-243`
**Issue:** React may invoke an updater more than once (StrictMode, replayed renders). Revoking is
idempotent so nothing breaks today, but the updater is no longer pure.
**Fix:** compute the URL to revoke outside the updater (`const gone = images.find(...)`) and revoke
after the `setImages` call.

### C-IN-06: the delete-failure toast on the feed surface is sourced from the share label block

**File:** `apps/web/components/feed/FeedSurface.tsx:49-52`
**Issue:** `useDeletePost(..., { deleted: menu?.deletedLabel ?? '', error: share.error })`. Both
resolve to `tf('errors.generic')` in `registry.tsx`, so the rendered string is right — but a delete
failure reading its copy out of the `share` prop is the kind of coupling that breaks the moment the
share block gains its own error sentence.
**Fix:** add `errorLabel` to the `menu` prop and pass `menu.errorLabel`.

### C-IN-07: `@source "../../../packages/modules"` scans server and contract sources too

**File:** `apps/web/app/globals.css:8-10`
**Issue:** the directive points at the whole `packages/modules` tree, so Tailwind's extractor also
walks `*/server`, `*/db` and `*/contracts` looking for class names. Harmless today, but it widens
the scan surface and can mint classes from unrelated string literals.
**Fix:** narrow to the UI directories, e.g. `@source "../../../packages/modules/*/ui";`.

### C-IN-08: a variable named `twoComments` holds the count `3`

**File:** `apps/web/e2e/feed-comments.spec.ts:190`
**Issue:** `const twoComments = F.meta.comments.other.replace('{count}', '3');` — the name and the
value disagree, and the `3` is an undocumented magic number tied to the seed.
**Fix:** rename and derive: read the count out of `metaBefore` and assert `before + 1`.

### C-IN-09: the login fixture's URL assertion is unanchored at the start

**File:** `apps/web/e2e/fixtures.ts:128`
**Issue:** `new RegExp(\`${expectedPath.replace(/\//g, '\\/')}$\`)` builds `/\/inicio$/`, which also
matches `/qualquer/inicio`. Only the escape of `/` is handled; any other regex metacharacter in
`expectedPath` would be interpreted.
**Fix:** `await expect(page).toHaveURL(new RegExp(\`${escapeRegExp(expectedPath)}$\`))` with a real
escape helper, or compare against the full expected URL.

### C-IN-10: the non-idempotent create endpoint's only dedupe is a rendered `disabled` attribute

**File:** `apps/web/app/(app)/criar/ComposerForm.tsx:294-296, 406-411`
**Issue:** `createPostSchema`'s docblock states *"two identical requests create two distinct
posts … The composer's submit control is the only dedupe"*. That control is
`disabled={!publishable || busy}`, i.e. state that becomes true only after a re-render. There is no
synchronous guard in `submit()` itself.
**Fix:** add a ref latch, which costs two lines and removes the reliance on render timing:

```ts
const inFlight = useRef(false);
const submit = () => {
  if (inFlight.current) return;
  inFlight.current = true;
  startTransition(async () => { try { … } finally { inFlight.current = false; } });
};
```

---

_Reviewed: 2026-09-23_
_Reviewer: Claude (gsd-code-reviewer) — Part C, `apps/web`_
_Depth: standard_
