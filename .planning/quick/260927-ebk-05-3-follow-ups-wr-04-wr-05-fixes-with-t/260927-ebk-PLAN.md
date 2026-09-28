---
phase: quick-260927-ebk
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/components/reels/ReelsHost.tsx
  - apps/web/components/reels/ReelsHost.test.tsx
  - packages/modules/reels/ui/ReelsPager.tsx
  - packages/modules/reels/tests/reels-pager.test.tsx
  - packages/modules/reels/ui/ReelCaption.tsx
  - packages/modules/reels/tests/reel-caption.test.tsx
  - packages/modules/reels/ui/ReelsLanes.tsx
  - packages/modules/reels/tests/reels-lanes.test.tsx
  - .planning/phases/05.3-reels/05.3-VALIDATION.md
  - .planning/phases/05.3-reels/05.3-UI-REVIEW.md
autonomous: true
requirements: [REELS-04, REELS-05, REELS-07, REELS-08]
tags: [nextjs, react, pointer-events, tailwind, vitest, testing-library, happy-dom, reels, a11y]

estimate:
  tokens: 90000
  raw_tokens: 90000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "WR-04: a like that the server confirms (ok) followed by an unlike that the server refuses ({ ok: false }) leaves the post liked with the confirmed count after its page goes ±2 and comes back (ReelsHost.test 'CR-01 (h)'); a REJECTED latest request does the same (ReelsHost.test 'CR-01 (i)'); both cases were observed red before the fix (the verifier's reproduction: 'unliked', count '')"
    - "WR-04 regression guard: CR-01, CR-01 (a)..(g) stay green unchanged — in particular (e) latest-wins (a stale ok answer never re-seeds a mounted page mid-flight), (f) one generic toast on a refusal, and (g) nothing written to Web Storage"
    - "WR-05: with finger 1 (pointerId 1, primary) down on media-p0 and dragged 100 px up, finger 2 (pointerId 2, non-primary) pressing and releasing on overlay-p0 at (+160, −150) from finger 1's origin fires no lane or page event and leaves the drag running; finger 1's own release then pages exactly once (reels-pager.test 'WR-05: …' cases, observed red before the fix with events = [['lane', -1]])"
    - "WR-05: a second pointer's pointercancel over the rail does not cancel the first pointer's drag, and a non-primary pointerdown on the video never replaces the first pointer's origin"
    - "Every existing reels-pager case (single-pointer swipes, the ends and the cancel, taps and double taps, WR-01 mouse release over the rail, WR-03) stays green; the only edit to them is `isPrimary: true` on their pointer-init objects"
    - "UI-REVIEW fix 1: the '… mais' and 'menos' caption toggles each reach a ≥44 px tall hit area while their labels, the gradient, the line boxes and the expanded caption's scroll range stay exactly where they were"
    - "UI-REVIEW fix 2: the active-lane underline is drawn by an inner label span (border-b-2 pb-1), the 44 px h-11 hit area stays on the tab button, and role=tab, aria-selected, aria-controls, tabIndex and the arrow/Home/End keyboard behaviour are unchanged"
    - "UI-REVIEW fix 3: the empty-state 'Criar publicação' CTA is rendered by the codebase's Button-as-Link (`LinkButton`, variant brand, size md) to /criar, only for `canPost`, with a white focus ring and no ring offset on the dark Reels surface"
    - "05.3-VALIDATION.md is Nyquist-compliant (frontmatter nyquist_compliant: true, no unchecked sign-off box) with the WR-04/WR-05 escalated rows marked resolved by name; 05.3-UI-REVIEW.md has an 'Applied' section and its scores are unchanged; 05.3-VERIFICATION.md and 05.3-UAT.md are byte-identical to BASE"
  artifacts:
    - "apps/web/components/reels/ReelsHost.tsx — `confirmed` ref (last server-confirmed like pair per post, with the seq that produced it); `trackLike` publishes it when the post's latest request settles, on ok, refusal and rejection; header/likeSeq/trackLike docblocks describe the new rule; the empty-state CTA is `LinkButton`"
    - "apps/web/components/reels/ReelsHost.test.tsx — 'CR-01 (h)' and 'CR-01 (i)' in the CR-01 describe; `deferred()` also returns `reject`; the empty-state CTA test asserts the shared Button geometry and the white ring"
    - "packages/modules/reels/ui/ReelsPager.tsx — `origin` carries `pointerId`; onPointerDown ignores non-primary pointers; move/up/cancel/leave ignore every pointer but the gesture's own"
    - "packages/modules/reels/tests/reels-pager.test.tsx — describe 'ReelsPager — only the pointer that started a gesture decides it (WR-05, D-117)' with three 'WR-05: …' cases"
    - "packages/modules/reels/ui/ReelCaption.tsx — '… mais' pseudo-element hit area, 'menos' upward pad"
    - "packages/modules/reels/ui/ReelsLanes.tsx — inner label span carries border-b-2 pb-1 + truncate"
  key_links:
    - "`confirmed` (ReelsHost) → `setInteractions` → `withInteraction(view, interactions[view.id])` in `renderOverlay` → the overlay's like seed → `useOptimisticLike`'s re-seed (packages/modules/feed/ui/LikeButton.tsx:63-67): the published pair is what a remounted page starts from"
    - "`origin.current.pointerId` is written ONLY in `onPointerDown` and compared in `onPointerMove`, `onPointerUp` (wired as `onPointerUpCapture`), `onPointerCancel` (wired as `onPointerCancelCapture`) and `onPointerLeave`"
    - "happy-dom's `PointerEvent` defaults `isPrimary` to false (node_modules/.pnpm/happy-dom@20.14.5/node_modules/happy-dom/lib/event/events/PointerEvent.js:39): the new `isPrimary` guard and the `isPrimary: true` fixture edits in reels-pager.test.tsx move TOGETHER, or every existing swipe case goes silent"
    - "`LinkButton` merges its className through `cn` (tailwind-merge), so `focus-visible:ring-white focus-visible:ring-offset-0` REPLACES its default `focus-visible:ring-brand focus-visible:ring-offset-2`"
---

<objective>
Close the five 05.3 follow-ups the developer approved after the 05.3 UAT and UI audit, each with a
test that proves it:

1. **WR-04** (05.3-REVIEW.md, 05.3-VERIFICATION.md Anti-Patterns) — `trackLike` in `ReelsHost.tsx`
   forgets a successful like when a later toggle for the same post is refused, so a remounted page
   reverts to the stale server view. Keep the last server-confirmed pair per post and publish it when
   the latest request settles, whatever its outcome.
2. **WR-05** — since the WR-01 capture-phase release, a second finger's `pointerup` on the rail or
   caption is measured against the first finger's origin and changes the lane or the video. Tie the
   gesture to the pointer that started it (`pointerId` in `origin`, plus `isPrimary`).
3. **UI-REVIEW fix 1** — 44 px hit areas on the "… mais" / "menos" caption toggles, no visual change.
4. **UI-REVIEW fix 2** — the active-lane underline moves onto an inner label span; the button keeps `h-11`.
5. **UI-REVIEW fix 3** — the empty-state "Criar publicação" CTA renders through the shared Button's
   link form (`LinkButton`) with the white focus ring.

Then resolve the two escalated rows in 05.3-VALIDATION.md (Nyquist-compliant) and note the applied
fixes in 05.3-UI-REVIEW.md.

Shape: three sequential tasks (quick mode, ISOLATION=none, one working tree). No tracer task: these
are defect fixes inside an architecture that is already shipped and verified; each task is proven
end-to-end by its own component tests (same shape as quick 260926-d8f).

Output: the 8 code/test files above, the two doc updates, and
`.planning/quick/260927-ebk-05-3-follow-ups-wr-04-wr-05-fixes-with-t/260927-ebk-SUMMARY.md`.
</objective>

<execution_context>
@./.claude/gsd-core/workflows/execute-plan.md
@./.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@.planning/phases/05.3-reels/05.3-REVIEW.md
@.planning/phases/05.3-reels/05.3-VERIFICATION.md
@.planning/phases/05.3-reels/05.3-UI-REVIEW.md
@.planning/phases/05.3-reels/05.3-VALIDATION.md

<hard_constraints>
- Do NOT run `pnpm db:reset` or `pnpm db:seed` (the developer's local UAT data must survive). Nothing in this plan needs the database.
- Do NOT edit or re-attest `.planning/phases/05.3-reels/05.3-VERIFICATION.md` (it stays `human_needed` until the phone UAT after Phase 01.1) and do NOT edit `05.3-UAT.md`. Its `covered_digest` WILL go stale because covered code changes here; that is expected and is not to be "fixed".
- No new npm packages; `package.json` files and `pnpm-lock.yaml` stay unchanged.
- No new user-facing text in TSX: every string stays in `apps/web/messages/pt-BR/*.json` (none is added — the CTA keeps `labels.emptyCta`).
- Disk is ~95% full (11 GiB free at planning time): no `next build`, no `turbo run build`. If any turbo-driven command is run (`pnpm lint`, `pnpm boundaries`), prefix it with `TURBO_CACHE=local:r`. The gates below call package scripts directly through `pnpm --filter`, which does not go through turbo.
- Sequential on the main working tree (no git remote, ISOLATION=none). Before Task 1's first commit record `BASE=$(git rev-parse HEAD)` for the final diff checks; shell state does not persist between calls, so the verify commands fall back to `e9afe9e` (HEAD at planning time; the plan's own docs commit touches none of the guarded files).
- Commit messages follow the quick precedent: `test(quick-260927-ebk): …` for red tests, `fix(quick-260927-ebk): …` for fixes, `docs(quick-260927-ebk): …` for the doc updates.
</hard_constraints>

<interfaces>
ReelsHost.tsx (apps/web/components/reels) — read these regions, do not re-read the whole 1,029-line file:
- Header docblock ~95-110: the "Per-post interaction state (CR-01)" paragraph describes the latest-only rule and says a refusal writes nothing to the map; it must describe the new rule after Task 1.
- `type ReelInteraction = { like?: LikeState; commentCount?: number }` (~186); `withInteraction(view, entry)` (~192).
- State (~290-298): `const [interactions, setInteractions] = useState<Record<string, ReelInteraction>>({})`; `const likeSeq = useRef(new Map<string, number>())` with the comment "The number of the latest like request per post: only that request's answer is recorded."
- `trackLike` (~706-724): `useCallback(async (postId: string, nextLiked: boolean): Promise<LikeOutcome> => …, [onLike, onUnlike])`; bumps `likeSeq`, awaits `onLike`/`onUnlike`, writes `{ liked, likeCount }` into `interactions` only when `outcome.ok` and its seq is still latest; does not catch. `onLikeTracked`/`onUnlikeTracked` wrap it.
- Empty state (~905-930): `EmptyState` `action={canPost ? <Link href="/criar" className="inline-flex h-11 … focus-visible:ring-white">{labels.emptyCta}</Link> : undefined}`. `Link` (next/link, line 27) is used ONLY there.
- `LikeOutcome = { ok: true; liked: boolean; likeCount: number } | { ok: false }` and `LikeState = { liked: boolean; likeCount: number }` come from `@rede-social/module-feed/ui`.
- ReelOverlay.tsx:97-99 turns `{ ok: false }` into a thrown `Error('like_refused')`; the engine (`useOptimisticLike`, LikeButton.tsx:75-105) catches any throw/rejection of the LATEST request, reverts to `previous` and calls `onError` (the generic toast). A stale request's settle is ignored by the engine (`requestId`).

ReelsHost.test.tsx helpers (reuse, do not duplicate): `renderHost(overrides)`, `flush()`, `press(key)`, `heartOn(i)`, `countOn(i, 'like' | 'comment')`, `pageAt(i)`, `position()`, `f(key)` (feed catalog), `toast.show` (mocked `useToast`), `deferred<T>()` at ~247 (returns `{ promise, resolve }` only), `postId(n)`. CR-01 describe starts ~967; (e) latest-wins ~1140 and (f) refusal-on-remount ~1174 are the templates for the new cases. The empty-state CTA test is at ~695 ('an author gets "Criar publicação" to /criar in the empty state'). `@rede-social/ui` is mocked by spreading the original (so `cn` is real).

ReelsPager.tsx (packages/modules/reels/ui):
- `const origin = useRef<{ x: number; y: number } | null>(null)` (~220).
- Handlers ~334-373: `onPointerDown` (gesturesDisabled + mouse non-left-button guards, sets origin, `setDrag({ active: true, dx: 0, dy: 0 })`), `onPointerMove`, `onPointerUp` (clears origin, `setDrag(IDLE)`, dominant-axis decision → `go(index ± 1)` / `onLaneStep?.(±1)`), `onPointerCancel()` (no args; resets), `onPointerLeave` (mouse only; calls `onPointerCancel()`).
- Wiring ~408-414 on `data-testid="reels-stack"`: `onPointerDown`, `onPointerMove`, `onPointerUpCapture={onPointerUp}`, `onPointerCancelCapture={onPointerCancel}`, `onPointerLeave`.
- Overlay layers use `STOP_POINTER` (~156: stops bubbling pointerdown/move/up/cancel), so a press that begins on the rail never reaches `onPointerDown`, but its release DOES reach the capture-phase `onPointerUp`.
- Docblock ~36-47 explains the capture-phase release (WR-01).

reels-pager.test.tsx harness: `baseProps()` records `['activate', n]`, `['index', n]`, `['lane', ±1]`, `['end']`, `['togglePause']`, `['doubleTap']`, `['toggleSound']` into `events`; `stack()`, `track()`; `drag(target, dx, dy)` (~125, init `{ clientX: 200, clientY: 400, pointerId: 1, pointerType: 'touch' }`), `tap(target)` (~133), the cancel case's `at` (~236), and the WR-01 describe's `mouse` const (~552). Test ids `media-p0`, `overlay-p0`. A 100 px upward drag at index 0 shows `-35px` in `track().style.transform`; idle shows `+ 0px)`. Fake timers are on.

ReelCaption.tsx (packages/modules/reels/ui): `TOGGLE = cn('text-sm font-bold text-white/70', RING)` (~65). "menos" (~176-184) is an inline `<button className={TOGGLE}>` at the end of the expanded `<p>`, which is the `max-h-[40vh] overflow-y-auto` scroll container. "… mais" (~186-199) is `cn('absolute right-0 bottom-0 bg-gradient-to-r from-transparent to-black/70 pl-6', TOGGLE)` over the clamped paragraph. Tests: reel-caption.test.tsx '… mais' class assertions at ~142-150, expanded "menos" at ~198-210.

ReelsLanes.tsx (packages/modules/reels/ui) ~123-152: each tab is `<button role="tab" id aria-selected aria-controls tabIndex onClick onKeyDown className={cn('h-11 max-w-40 shrink-0 truncate border-b-2 px-1 text-sm', active ? 'border-white font-bold text-white' : 'border-transparent font-normal text-white/70', SHADOW, RING)}>{lane.label}</button>`. Tests: reels-lanes.test.tsx ~96-104 (active/idle classes on the button) and ~121-130 (60-char label: `truncate` + `max-w-40` on the button).

Button-as-Link precedent: `@rede-social/ui` `Button` (packages/ui/src/primitives/Button.tsx) is a `<button>` only — no `asChild`, no exported class builder. The codebase's link form is `LinkButton` in `apps/web/app/(auth)/LinkButton.tsx` (`href`, `variant: 'brand' | 'outline' | 'ghost'`, `size: 'md' | 'lg'`, `fullWidth`, `className`; mirrors Button's geometry and tokens; renders `next/link`). It is already imported from client components as `import { LinkButton } from '@/app/(auth)/LinkButton'` (apps/web/components/profile/ProfileNudgeCard.tsx:8, apps/web/components/platform/TenantTable.tsx:7), both with `variant="brand"`.

Hit-area precedent: apps/web/components/platform/TenantTable.tsx:42 extends a hit area with `after:absolute after:inset-0 after:content-[""]`.

TDD red evidence: Vitest emits no TAP. If the TDD flow asks for machine-readable RED evidence (`check tdd-red-evidence`), pipe the REAL failing Vitest output through a throwaway normalizer in the session scratchpad (never committed); the record's `command`, `exitCode`, `targetTest`, `targetFile`, `output` fields are top-level. Never fabricate counts.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: WR-04 + WR-05 — the confirmed like survives a refused latest toggle, and only the starting pointer decides a gesture</name>
  <files>apps/web/components/reels/ReelsHost.test.tsx, apps/web/components/reels/ReelsHost.tsx, packages/modules/reels/tests/reels-pager.test.tsx, packages/modules/reels/ui/ReelsPager.tsx</files>
  <behavior>
    - CR-01 (h) "CR-01 (h): a like confirmed before a refused unlike is what a remounted page shows (WR-04)": `onLike` returns a pending deferred A, `onUnlike` a pending deferred B. Click like, flush, click unlike, flush (like ×1, unlike ×1). Resolve A `{ ok: true, liked: true, likeCount: 1 }`, flush: page 0's heart still reads aria-pressed "false" (latest-wins, as in (e)). Resolve B `{ ok: false }`, flush: page 0 reads data-like-state "liked", like count "1", `toast.show` called exactly once with `{ tone: 'error', message: f('errors.generic') }`. Then ArrowDown, ArrowDown, ArrowUp, ArrowUp: page 0 still reads "liked" with count "1", and like/unlike are still ×1 each (a remount sends nothing). Red today: after the round trip it reads "unliked" with count "".
    - CR-01 (i) "CR-01 (i): a rejected latest request still leaves the confirmed like for a remounted page (WR-04)": same as (h) but B REJECTS with an Error instead of resolving `{ ok: false }`; after the round trip page 0 reads "liked" with count "1"; one generic toast. Red today for the same reason.
    - WR-05 case 1 "WR-05: a second finger tapping the rail while the first rests on the video moves neither the lane nor the video": render `<ReelsPager {...baseProps()} />`; finger 1 = `{ pointerId: 1, isPrimary: true, pointerType: 'touch' }`, finger 2 = `{ pointerId: 2, isPrimary: false, pointerType: 'touch' }`. pointerDown on `media-p0` at (200, 400) with finger 1; pointerMove on the stack to (200, 300) with finger 1 → track shows `-35px`. pointerDown then pointerUp on `overlay-p0` at (360, 250) with finger 2 (that is +160, −150 from finger 1's origin) → `events` equals `[]` and the track still shows `-35px`. pointerUp on the stack at (200, 300) with finger 1 → `events` equals `[['activate', 1], ['index', 1]]` and the track no longer shows `-35px`. Red today: `[['lane', -1]]` after finger 2's release (the verifier's reproduction).
    - WR-05 case 2 "WR-05: a second pointer's cancel on the rail leaves the first pointer's drag running": finger 1 down on `media-p0` at (200, 400) and moved to (200, 300); finger 2 pointerDown then pointerCancel on `overlay-p0` → the track still shows `-35px` and `events` is `[]`; finger 1's pointerUp on the stack at (200, 300) pages once (`[['activate', 1], ['index', 1]]`). Red today: the cancel resets the drag and finger 1's release decides nothing.
    - WR-05 case 3 "WR-05: a non-primary pointerdown on the video never takes over the first pointer's gesture": finger 1 down on `media-p0` at (200, 400); finger 2 (non-primary) pointerDown on `media-p0` at (200, 100) with no release; finger 1 pointerMove on the stack to (200, 300) → the track shows `-35px` (not `+ 70px`); finger 1 pointerUp on the stack at (200, 300) → `[['activate', 1], ['index', 1]]`. Red today: finger 2's press replaces the origin.
    - Every existing reels-pager case and every existing ReelsHost case (notably CR-01 (e), (f), (g) and "a refused like reverts and raises the generic toast") stays green.
  </behavior>
  <action>
Tests first: write them, watch them fail for the reasons in behavior, then fix. Record `BASE=$(git rev-parse HEAD)` before the first commit.

1. RED, WR-04 — apps/web/components/reels/ReelsHost.test.tsx:
   - Extend the file's `deferred<T>()` helper to also return a `reject(reason)` (additive; existing callers keep using `promise`/`resolve`).
   - Append 'CR-01 (h) …' and 'CR-01 (i) …' (exact titles in behavior) at the end of the CR-01 describe, modelled on (e) and (f), using only the existing helpers listed in interfaces.
   - Run `pnpm --filter @rede-social/web exec vitest run components/reels/ReelsHost.test.tsx -t "WR-04"`; confirm both fail on the post-round-trip assertion ("unliked" / "") and record the failing assertions for the SUMMARY.

2. RED, WR-05 — packages/modules/reels/tests/reels-pager.test.tsx:
   - Add `isPrimary: true` to the pointer-init object of `drag()`, of `tap()`, of the cancel case (~236) and of the WR-01 describe's `mouse` const (~552), i.e. every existing init that carries `pointerId: 1`. Rationale (put it in a one-line comment on `drag`): a real browser's lone pointer is always primary, while happy-dom's `PointerEvent` defaults `isPrimary` to false. Change no expectation of any existing case.
   - Append a describe 'ReelsPager — only the pointer that started a gesture decides it (WR-05, D-117)' with the three cases titled exactly as in behavior; fire each pointer event on the element named there (finger 2's press and release on `overlay-p0`, finger 1's moves and release on `stack()`).
   - Run `pnpm --filter @rede-social/module-reels test -- -t "WR-05"` (or `pnpm --filter @rede-social/module-reels exec vitest run tests/reels-pager.test.tsx -t "WR-05"`); confirm all three fail as described (case 1 with `[['lane', -1]]`), then run the whole module suite once to confirm the `isPrimary` fixture edit alone changed nothing (122 passed + 3 new failing).
   - Commit the red tests of steps 1-2: `test(quick-260927-ebk): add red WR-04 and WR-05 cases`.

3. GREEN, WR-04 — apps/web/components/reels/ReelsHost.tsx (the review's fix, with one hardening):
   - Beside `likeSeq`, add `const confirmed = useRef(new Map<string, { seq: number; like: LikeState }>())`: the last SERVER-confirmed pair per post for this visit, tagged with the seq of the request that produced it. Like `interactions`, it is visit-scoped (a ref inside the host) and never persisted.
   - Rewrite `trackLike`: take `seq` exactly as today; define a local `publish()` that returns early unless `likeSeq.current.get(postId) === seq` (a newer request will publish), and otherwise, when `confirmed` holds a pair for the post, writes it with `setInteractions((map) => ({ ...map, [postId]: { ...map[postId], like: pair } }))`. Then, inside try: await the action; on `outcome.ok` store `{ seq, like: { liked: outcome.liked, likeCount: outcome.likeCount } }` into `confirmed` ONLY IF no pair is held or the held pair's seq is lower than `seq` (Next serialises server actions so answers normally arrive in order; the guard makes an out-of-order older answer unable to replace a newer confirmed pair); call `publish()`; return the outcome unchanged. In catch: call `publish()` and rethrow (the engine must still see the rejection, revert and raise the toast).
   - Update the three comments to the new rule: the header docblock's CR-01 paragraph (the host keeps the last server-confirmed pair per post and publishes it when the post's LATEST request settles, whatever its outcome — an older request's ok answer is remembered but never re-seeds a mounted page mid-flight, and a refused or rejected latest request still leaves the confirmed pair for a page that remounts; WR-04), the `likeSeq` comment (it now decides WHEN the confirmed pair is published), and the `trackLike` docblock. Keep the sentences about the map being visit-scoped and never persisted.
   - Do not touch IN-06/IN-07 behaviour (no pending-target seeding, no LikeButton change) — out of scope.

4. GREEN, WR-05 — packages/modules/reels/ui/ReelsPager.tsx (the review's fix, with one deliberate difference):
   - `origin` becomes `useRef<{ x: number; y: number; pointerId: number } | null>(null)`.
   - `onPointerDown`: return early when `gesturesDisabled`, when `!event.isPrimary`, or on a non-left mouse button; otherwise set `origin.current = { x, y, pointerId: event.pointerId }` and start the drag. Discretion (differs from the review's `|| origin.current` guard, recorded here): a PRIMARY pointerdown always (re)starts the gesture. Per Pointer Events a new primary pointer of a type exists only when no other pointer of that type is active, so an origin still held at that moment is stale (its release never reached the stack); overwriting it self-heals instead of locking the pager until reload.
   - `onPointerMove`: ignore unless `origin.current` exists and `event.pointerId === origin.current.pointerId`.
   - `onPointerUp` (still wired as `onPointerUpCapture`): when there is no origin or `event.pointerId !== origin.current.pointerId`, return WITHOUT clearing the origin and WITHOUT `setDrag(IDLE)` (another pointer's release is not this gesture's end — this also drops the re-render every rail tap caused); otherwise behave exactly as today (clear, reset, dominant-axis decision).
   - `onPointerCancel` takes the event: return when an origin exists and `event.pointerId !== origin.current.pointerId`; otherwise reset as today. `onPointerLeave`: reset only when an origin exists, `event.pointerType === 'mouse'` and the pointerId matches (pass the event through to `onPointerCancel`).
   - Extend the docblock's point 3 (~36-47) by one or two sentences: the gesture belongs to the primary pointer that started it (`origin.pointerId`); every other pointer's move, release and cancel are ignored (WR-05), so a second finger tapping the rail or the caption never decides the first finger's drag.
   - The wiring on `reels-stack` (capture-phase release/cancel from WR-01) and everything else in the file stay as they are.

5. Run the gates in verify; commit `fix(quick-260927-ebk): keep the confirmed like across a refused toggle and tie Reels gestures to their pointer`. Use `pnpm --filter <pkg> exec biome check --write <path>` only to fix formatting/import order that `lint` reports in the files of this task.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run components/reels/ReelsHost.test.tsx -t "CR-01"</automated>
    <automated>pnpm --filter @rede-social/module-reels exec vitest run tests/reels-pager.test.tsx</automated>
    <automated>pnpm --filter @rede-social/module-reels test &amp;&amp; pnpm --filter @rede-social/module-reels typecheck &amp;&amp; pnpm --filter @rede-social/module-reels lint</automated>
    <automated>pnpm --filter @rede-social/web exec vitest run components/reels &amp;&amp; pnpm --filter @rede-social/web typecheck &amp;&amp; pnpm --filter @rede-social/web lint &amp;&amp; bash scripts/check-ui-literals.sh</automated>
    <automated>test "$(grep -c 'pointerId' packages/modules/reels/ui/ReelsPager.tsx)" -ge 5 &amp;&amp; grep -q 'isPrimary' packages/modules/reels/ui/ReelsPager.tsx &amp;&amp; grep -q 'const confirmed = useRef' apps/web/components/reels/ReelsHost.tsx</automated>
  </verify>
  <done>CR-01 (h) and (i) and the three WR-05 cases were observed red before the fixes (failing assertions recorded) and are green after them; CR-01 and CR-01 (a)..(g) and every earlier pager case are green with no expectation changed (only `isPrimary: true` added to pointer inits); both packages typecheck and lint clean; check-ui-literals passes.</done>
</task>

<task type="auto">
  <name>Task 2: UI-REVIEW fixes 1 and 2 — 44 px caption toggles with no visual change, and the lane underline tight to its label</name>
  <files>packages/modules/reels/ui/ReelCaption.tsx, packages/modules/reels/tests/reel-caption.test.tsx, packages/modules/reels/ui/ReelsLanes.tsx, packages/modules/reels/tests/reels-lanes.test.tsx</files>
  <action>
UI-REVIEW fix 1 (ReelCaption.tsx ~176-199). The binding requirement is "a 44 px hit area without changing the visual layout"; the review's class suggestions were examples. Implement it this way and record why in a short comment next to each toggle:

- "… mais" (the absolute, bottom-anchored button with the gradient): keep its box, its `pl-6`, gradient and position exactly as they are, and extend only the HIT area with a pseudo-element, following TenantTable.tsx:42: add `after:absolute after:inset-x-0 after:-inset-y-3 after:content-[""]`. The button is already positioned, so the pseudo-element is placed against it; its 20 px line box (Tailwind v4 `text-sm` line-height 1.25rem) plus 12 px above and below gives 44 px. Why not the review's `min-h-11 inline-flex items-center`: on a `bottom-0` absolute button a 44 px box either lifts the label off the clamped last line (centred) or stretches the gradient over line 1 and the video below.
- "menos" (inline at the end of the expanded paragraph): a `<button>` is inline-block, so add `pt-6 -mt-6` — 24 px of padding ABOVE the label with an equal negative margin, so the margin box, the line box and the label's baseline are unchanged and the hit area is 20 + 24 = 44 px. Why upward instead of the review's `py-3 -my-3`: "menos" always sits on the LAST line of the `overflow-y-auto` paragraph, so any pad below the line extends its scrollable overflow (a spurious 12 px scroll range, a visible scrollbar on desktop); an upward pad stays inside the lines above (an expanded caption has at least three lines), where a tap already collapses the caption through `onTextClick`.
- Compose the classes with `cn(…, TOGGLE)` / `cn(TOGGLE, …)`; do not change `TOGGLE` itself.
- reel-caption.test.tsx: add one case in the expanded or clamp describe, titled '"… mais" and "menos" reach a 44 px hit area without moving their label (UI-REVIEW fix 1)': with `layout.scrollHeight = 41` the "… mais" button's className contains `after:absolute`, `after:inset-x-0`, `after:-inset-y-3` and still `absolute`, `right-0`, `bottom-0`, `pl-6`, and does not contain `min-h-11`; re-rendered with `expanded: true`, the "menos" button's className contains `pt-6` and `-mt-6`. Existing caption assertions stay unchanged.

UI-REVIEW fix 2 (ReelsLanes.tsx ~142-147):
- The tab button keeps the hit area and the text styling: `inline-flex h-11 max-w-40 shrink-0 items-center px-1 text-sm` plus `font-bold text-white` (active) or `font-normal text-white/70` (idle), `SHADOW` and `RING`. Remove `border-b-2`, `border-white`/`border-transparent` and `truncate` from the button.
- Wrap `{lane.label}` in an inner `<span>` carrying `min-w-0 truncate border-b-2 pb-1` plus `border-white` (active) or `border-transparent` (idle), so the underline is drawn about 4 px under the text instead of at the bottom of the 44 px box, and a 60-character label still ellipsises inside `max-w-40`.
- Keep `role="tab"`, `id`, `aria-selected`, `aria-controls`, `tabIndex`, `onClick`, `onKeyDown`, the ref map and the pointer-stopping wrapper exactly as they are. The accessible name still comes from the label text.
- reels-lanes.test.tsx: update 'the active tab is white 700 underlined; …' (rename it to 'the active tab is white 700 with the underline on its label span; an idle tab is white/70 with a transparent one (UI-REVIEW fix 2)'): the active BUTTON contains `font-bold`, `text-white`, `h-11` and does not contain `border-b-2`; its inner span (the button's only element child) contains `border-b-2`, `border-white`, `pb-1`; the idle button contains `font-normal`, `text-white/70`; the idle span contains `border-b-2`, `border-transparent`. Update 'a 60-character label is the full accessible name and truncates at max-w-40': the button still contains `max-w-40` and its span contains `truncate` and `min-w-0`. No other lane test changes (the keyboard, selection, repeat and pointer cases must pass as they are).
- Optional visual cross-check: read `.planning/phases/05.3-reels/reels-design.png` to confirm the tight underline; no screenshot tooling is required.

Run the gates in verify; commit `fix(quick-260927-ebk): give the Reels caption toggles a 44 px hit area and draw the lane underline under the label`.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/module-reels exec vitest run tests/reel-caption.test.tsx tests/reels-lanes.test.tsx</automated>
    <automated>pnpm --filter @rede-social/module-reels test &amp;&amp; pnpm --filter @rede-social/module-reels typecheck &amp;&amp; pnpm --filter @rede-social/module-reels lint &amp;&amp; bash scripts/check-ui-literals.sh</automated>
    <automated>pnpm --filter @rede-social/web exec vitest run components/reels</automated>
  </verify>
  <done>Both caption toggles carry the 44 px hit-area classes with their visual box untouched; the lane underline lives on the inner label span and the button keeps h-11 and its tab semantics; the module suite (including the new caption case and the two updated lane cases) is green; typecheck, lint and check-ui-literals pass; the web Reels suite is still green (it renders the real lanes and caption through the pager).</done>
</task>

<task type="auto">
  <name>Task 3: UI-REVIEW fix 3 (the empty-state CTA through LinkButton), then resolve 05.3-VALIDATION and note the applied fixes in 05.3-UI-REVIEW</name>
  <files>apps/web/components/reels/ReelsHost.tsx, apps/web/components/reels/ReelsHost.test.tsx, .planning/phases/05.3-reels/05.3-VALIDATION.md, .planning/phases/05.3-reels/05.3-UI-REVIEW.md</files>
  <action>
Code first (UI-REVIEW fix 3, ReelsHost.tsx ~921-926):
1. Replace the hand-styled CTA with `<LinkButton href="/criar" variant="brand" size="md" className="focus-visible:ring-white focus-visible:ring-offset-0">{labels.emptyCta}</LinkButton>`, imported as `import { LinkButton } from '@/app/(auth)/LinkButton';` — the codebase's Button-as-Link (`@rede-social/ui` `Button` has no `asChild` and exports no class builder; ProfileNudgeCard.tsx and TenantTable.tsx use the same import). `LinkButton` merges `className` through `cn` (tailwind-merge), so the white ring with no offset replaces its default brand ring and ring offset on the dark Reels surface — the same override the sound button already uses. It stays inside `canPost ? … : undefined`. Remove the now-unused next/link import (Biome fails on unused imports) and let `biome check --write` order the imports.
2. ReelsHost.test.tsx: extend 'an author gets "Criar publicação" to /criar in the empty state' (keep its title): besides `href` === '/criar', the link's className contains `bg-brand`, `text-on-brand`, `rounded-xl`, `h-11`, `px-5`, `focus-visible:ring-white`, `focus-visible:ring-offset-0`, and does not contain `focus-visible:ring-brand`. The non-author empty-state case keeps asserting no CTA.
3. Run `pnpm --filter @rede-social/web exec vitest run components/reels`, `pnpm --filter @rede-social/web typecheck`, `pnpm --filter @rede-social/web lint`, `bash scripts/check-ui-literals.sh`; commit `fix(quick-260927-ebk): render the Reels empty-state CTA through LinkButton with the white ring`.

Then the docs (only after steps 1-3 and Tasks 1-2 are green; use Edit, never a whole-file Write):
4. .planning/phases/05.3-reels/05.3-VALIDATION.md:
   - Frontmatter: `nyquist_compliant: false` → `nyquist_compliant: true`. Leave `status: validated` and the dates.
   - The paragraph that starts `**Escalated (2026-09-27 audit):**` becomes `**Escalated (2026-09-27 audit) → resolved by quick 260927-ebk (2026-09-27):**` followed by one sentence: both reproduced warnings now have a test that failed against the old code and passes after the fix. In its table, keep the Gap / Requirement / Missing behavior columns (rename the last header "Behavior") and replace the "Test to add" column with "Test" and a "Status" column: WR-04 → `apps/web/components/reels/ReelsHost.test.tsx` › "CR-01 (h): …" and "CR-01 (i): …" (full titles), `✅ green (resolved)`; WR-05 → `packages/modules/reels/tests/reels-pager.test.tsx` › the three "WR-05: …" titles, `✅ green (resolved)`.
   - Validation Sign-Off: tick the last checkbox (the `nyquist_compliant` line) and replace its parenthetical with "(quick 260927-ebk resolved WR-04 and WR-05)". Set the Approval line to `**Approval:** validated 2026-09-27; Nyquist-compliant after quick 260927-ebk (WR-04 and WR-05 resolved)`.
   - Append at the end a section `## Validation Audit 2026-09-27 (follow-up, quick 260927-ebk)` with a Metric/Count table (Gaps found 2 — the escalated WR-04/WR-05; Resolved 2; Escalated 0) and a short Suite/Result table carrying the REAL counts of this plan's final runs (`pnpm --filter @rede-social/module-reels test`, `pnpm --filter @rede-social/web exec vitest run components/reels`, plus the Playwright run if it was made). Add one line: 05.3-VERIFICATION.md was not edited; its covered digest is stale because covered Reels code changed, and it is re-verified after the Phase 01.1 phone UAT rather than re-attested here.
5. .planning/phases/05.3-reels/05.3-UI-REVIEW.md: insert, right after the "Minor: …" paragraph that closes "Top 3 Priority Fixes" (before the `---` that precedes "Detailed Findings"), a section `## Applied (quick 260927-ebk, 2026-09-27)` with: one sentence that the scores above are the audit's and were not re-rated; three numbered items — Fix 1 applied (ReelCaption.tsx: "… mais" pseudo-element hit area, "menos" 24 px upward pad, both 44 px with no layout or scroll change; test title), Fix 2 applied (ReelsLanes.tsx: underline on the inner label span `border-b-2 pb-1`, `h-11` stays on the tab; updated test titles), Fix 3 applied (ReelsHost.tsx: `LinkButton` brand/md with the white ring; test title); and one line that the Minor items (the `right-[3px]`/`w-[3px]` ticks, the ReelsHost.tsx size) were not applied. Do not change the Pillar Scores table, the Overall line or any Detailed Findings text.
6. Final diff checks (verify), then commit `docs(quick-260927-ebk): resolve the 05.3 WR-04/WR-05 validation rows and record the applied UI-review fixes`.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run components/reels &amp;&amp; pnpm --filter @rede-social/web typecheck &amp;&amp; pnpm --filter @rede-social/web lint &amp;&amp; bash scripts/check-ui-literals.sh</automated>
    <automated>grep -q 'LinkButton' apps/web/components/reels/ReelsHost.tsx &amp;&amp; grep -q '^nyquist_compliant: true' .planning/phases/05.3-reels/05.3-VALIDATION.md &amp;&amp; test "$(grep -c -- '- \[ \]' .planning/phases/05.3-reels/05.3-VALIDATION.md)" = "0" &amp;&amp; grep -q 'CR-01 (h)' .planning/phases/05.3-reels/05.3-VALIDATION.md &amp;&amp; grep -q 'WR-05: a second finger' .planning/phases/05.3-reels/05.3-VALIDATION.md &amp;&amp; grep -q '260927-ebk' .planning/phases/05.3-reels/05.3-VALIDATION.md</automated>
    <automated>grep -q '^## Applied (quick 260927-ebk' .planning/phases/05.3-reels/05.3-UI-REVIEW.md &amp;&amp; grep -q '^\*\*Overall: 21/24\*\*' .planning/phases/05.3-reels/05.3-UI-REVIEW.md</automated>
    <automated>git diff --quiet "${BASE:-e9afe9e}" -- .planning/phases/05.3-reels/05.3-VERIFICATION.md .planning/phases/05.3-reels/05.3-UAT.md &amp;&amp; git diff --quiet "${BASE:-e9afe9e}" -- pnpm-lock.yaml apps/web/package.json packages/modules/reels/package.json package.json &amp;&amp; test -z "$(git status --porcelain -- supabase)"</automated>
  </verify>
  <done>The empty-state CTA is a LinkButton (brand, md, white ring, /criar, authors only) and the web Reels suite, typecheck, lint and check-ui-literals are green; 05.3-VALIDATION.md is Nyquist-compliant with the WR-04/WR-05 rows resolved by test name and a follow-up audit note naming quick 260927-ebk with real counts; 05.3-UI-REVIEW.md has the Applied section with unchanged scores; 05.3-VERIFICATION.md, 05.3-UAT.md, dependencies and supabase/ are unchanged since BASE.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| server action answer → `ReelsHost` visit map | The feed's like/unlike action answers `{ ok, liked, likeCount }`; only a server-confirmed pair may be shown as the post's state |
| touch/mouse input → `ReelsPager` navigation | Pointer events from any finger reach the stack's capture-phase handlers; only the gesture's own pointer may move the video or the lane |
| server props → empty-state CTA | `canPost` (the `feed.post.create` permission) and the static `/criar` href come from the server-resolved page |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-q-ebk-01 | Tampering (display integrity) | `trackLike` / `confirmed` | low | mitigate | Only an `ok` server answer enters `confirmed`, tagged with its seq; an older answer never replaces a newer pair; it is published only when the latest request settles, so the host never shows an optimistic or stale-superseded state as confirmed (CR-01 (e), (h), (i)) |
| T-q-ebk-02 | Information disclosure | visit-scoped like map | low | mitigate | `confirmed` is a ref inside `ReelsHost`, never written to Web Storage or cookies; CR-01 (g)'s `Storage.prototype.setItem` spy stays green |
| T-q-ebk-03 | Tampering (input integrity / unintended action) | `ReelsPager` pointer handlers | low | mitigate | The gesture is bound to the primary pointer that started it (`origin.pointerId`, `isPrimary`); another pointer's move, release or cancel is ignored, so a tap on the rail can no longer also change the video or lane (three WR-05 cases) |
| T-q-ebk-04 | Denial of service (UI lock) | `onPointerDown` origin handling | low | mitigate | A primary pointerdown always restarts the gesture, so a release that never reached the stack cannot leave a stale origin that blocks every later swipe |
| T-q-ebk-05 | Elevation of privilege | empty-state CTA | low | accept | The CTA is still rendered only for `canPost`; `/criar` enforces `feed.post.create` on the server regardless of what the client renders |
| T-q-ebk-SC | Tampering | npm installs | low | accept | No package is installed or upgraded; Task 3's verify asserts package.json files and pnpm-lock.yaml are unchanged since BASE |
</threat_model>

<verification>
After the three tasks, once:

- `pnpm --filter @rede-social/module-reels test` · `pnpm --filter @rede-social/module-reels typecheck` · `pnpm --filter @rede-social/module-reels lint`
- `pnpm --filter @rede-social/web exec vitest run components/reels` · `pnpm --filter @rede-social/web typecheck` · `pnpm --filter @rede-social/web lint`
- `bash scripts/check-ui-literals.sh`
- `git diff --stat "${BASE:-e9afe9e}"..HEAD -- apps packages .planning/phases` lists only the ten files in `files_modified` (the quick directory's PLAN/SUMMARY and STATE.md are the orchestrator's and are expected outside that filter).
- Optional, only if `df -h /System/Volumes/Data` shows at least 5 GiB free: `VIDEO_PROVIDER=fake pnpm --filter @rede-social/web exec playwright test reels.spec.ts` (about 1.5 min; it starts its own dev servers on the existing local data; no `db:reset`). Expected 28 passed / 6 declared skips as in the 2026-09-27 audit. If it is skipped, say so in the SUMMARY; do not claim it.

Record in the SUMMARY: the RED output of the five new cases before their fixes, the green runs after, the two deliberate differences from the review's snippets (the seq-tagged `confirmed` pair; a primary pointerdown restarts the gesture instead of being refused while an origin is held) and the two differences from the UI review's example classes (pseudo-element hit area on "… mais", upward pad on "menos"), and a note that 05.3-VERIFICATION.md's digest is now stale by design (re-verify after the Phase 01.1 phone UAT; do not re-attest).
</verification>

<success_criteria>
- WR-04: the last server-confirmed like pair per post survives a refused or rejected latest toggle across a remount; latest-wins, the single generic toast and the visit scope are unchanged.
- WR-05: only the primary pointer that started a gesture can end, cancel or steer it; single-pointer swipes, taps, double taps and the WR-01 mouse release behave as before.
- UI-REVIEW fixes 1-3 applied with no visual layout change beyond the tighter lane underline, no new strings, no new packages.
- 05.3-VALIDATION.md: nyquist_compliant true, escalated rows resolved by test name, audit note naming quick 260927-ebk. 05.3-UI-REVIEW.md: Applied section, scores untouched.
- No change to 05.3-VERIFICATION.md, 05.3-UAT.md, supabase/, package.json files or pnpm-lock.yaml; no `db:reset`/`db:seed` run.
</success_criteria>

<output>
Create `.planning/quick/260927-ebk-05-3-follow-ups-wr-04-wr-05-fixes-with-t/260927-ebk-SUMMARY.md` when done.
</output>
