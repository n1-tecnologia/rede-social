---
phase: quick-261117-kkx
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/lib/auth-confirm.ts
  - apps/web/lib/auth-confirm.test.ts
  - apps/web/app/auth/confirm/route.ts
  - apps/web/app/auth/confirm/route.test.ts
  - apps/web/app/(auth)/auth/continuar/page.tsx
  - apps/web/app/(auth)/auth/continuar/ConfirmForm.tsx
  - apps/web/app/(auth)/auth/continuar/page.test.tsx
  - apps/web/messages/pt-BR/confirmLink.json
  - apps/web/lib/link-return.ts
  - apps/web/lib/link-return.test.ts
  - apps/web/components/pwa/InstallGate.test.tsx
  - apps/web/lib/route-handlers.inventory.ts
  - apps/web/e2e/mail.ts
  - apps/web/e2e/recovery.spec.ts
  - apps/web/e2e/signup.spec.ts
  - apps/web/e2e/invite.spec.ts
  - docs/deploy/auth-mail.md
autonomous: true
requirements: []
tags: [bugfix, auth, mail-scanner, safelinks, auth-confirm, quick]

estimate:
  tokens: 80000
  raw_tokens: 80000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "A GET on /auth/confirm that carries token_hash and an allow-listed OTP type has NO side effect: it never creates the Supabase client, never calls verifyOtp, never writes a cookie. It answers a redirect to /auth/continuar carrying the same token_hash, the type and a next that already went through sameOriginPath. (Route test: createClient, verifyOtp and the cookie setter are all asserted not called; a hostile next in the mail link is sanitised in this hop.)"
    - "GET /auth/continuar (the interstitial) renders in the (auth) shell (tenant brand tokens on a tenant host, neutral on a generic or platform host) with ONE submit button inside a native form method=post action=/auth/confirm whose hidden fields are token_hash, type and next. Copy follows the link kind: recovery -> button 'Escolher nova senha'; signup or email -> 'Confirmar e-mail'; invite (type=invite OR next=/aceitar-convite) -> 'Aceitar convite'; magiclink -> 'Continuar'. The page calls no Supabase method, reads no cookie, and renders the token only as an escaped hidden input value."
    - "POST /auth/confirm is the ONLY place verifyOtp runs. Success writes link_return through linkReturnFor exactly as before (HttpOnly, host-only, 600 s) and answers 303 to sameOriginPath(next) (relative Location, Cache-Control no-store). Every failure keeps today's destination: allow-list refusal -> /entrar?erro=nao-liberado (wins over the others), invite or next=/aceitar-convite -> /convite-expirado, signup -> /verifique-seu-email?erro=link-invalido, everything else -> /esqueci-senha?erro=link-invalido. A failed exchange writes no cookie."
    - "The token never reaches a POST response Location, a log line or an unescaped HTML attribute. The interstitial sends <meta name=referrer content=same-origin> (NOT no-referrer: with no-referrer Chromium and Firefox send 'Origin: null' on a same-origin form POST, which would defeat the Origin check below) and noindex."
    - "The OTP type allow-list and the open-redirect guard are applied AGAIN on the POST input (hidden fields are client-controlled): an unknown type or a missing token_hash falls to the fallbacks without calling Supabase; next=//evil.example, /\\evil.example and https://evil.example all land on /inicio."
    - "A POST with positive evidence of a cross-site origin (Sec-Fetch-Site: cross-site, or an Origin whose host is none of the request's own hosts) is refused with 403 before Supabase is touched. A same-origin POST, a POST with Origin: null and a POST with neither header are accepted (no false refusals for real members). This is strictly stricter than today's GET, which any page could trigger with an img tag."
    - "A phone outside the installed app (INSTALL_GATE=on) still sees the interstitial: linkReturnScreen answers 'pass' for /auth/continuar and below even with no marker, so the install screen never hides the button. The post-click flow is unchanged: the 303 is a full document navigation, so the root layout re-reads link_return and the gate shows 'abra o app pelo icone' / the password forms exactly as before."
    - "Missing token_hash or unknown type on GET /auth/confirm (and on a direct visit to /auth/continuar) still redirect straight to the existing fallbacks; the button is never shown."
    - "UNCHANGED, by construction: the mail link shape (packages/core hook-schema, recovery/signup actions), proxy.ts (its public list already holds /^\\/auth\\// at proxy.ts:34, which covers /auth/continuar on every host mode), lib/auth-link-forward.ts, lib/link-return.ts marker rules, the API, the invite flow (type=invite, next=/aceitar-convite)."
    - "The e2e helper that follows a mail link now presses the interstitial button (followMailLink); recovery, signup and invite specs use it; one recovery and one signup case first fetch the link the way a scanner does (GET, no click) and prove the real click still works. These were checked by reading + tsc + biome and were NOT run (Playwright needs the local stack) unless the executor could run them and says so in the SUMMARY."
  artifacts:
    - path: "apps/web/lib/auth-confirm.ts"
      provides: "pure, client-safe helpers extracted from route.ts (a Next route file may only export HTTP methods): sameOriginPath, OTP_TYPES/isOtpType, isAcceptInvitePath, failureDestination, CONFIRM_CONTINUE_PATH, CONFIRM_POST_PATH, continueHref, isCrossSiteSubmission"
      contains: "isCrossSiteSubmission"
    - path: "apps/web/app/auth/confirm/route.ts"
      provides: "GET (inert: redirects to /auth/continuar or to the old fallbacks) and POST (verifyOtp, link_return cookie, 303)"
      contains: "export async function POST"
    - path: "apps/web/app/(auth)/auth/continuar/page.tsx"
      provides: "the interstitial server page (searchParams -> validated -> copy by kind -> ConfirmForm)"
      contains: "ConfirmForm"
    - path: "apps/web/app/(auth)/auth/continuar/ConfirmForm.tsx"
      provides: "native post form with hidden fields and a ref-guarded double-submit block"
      contains: "action=\"/auth/confirm\""
    - path: "apps/web/messages/pt-BR/confirmLink.json"
      provides: "namespace confirmLink: recovery/signup/invite/generic {title, body, action}, note, pending"
      contains: "confirmLink"
    - path: "apps/web/lib/link-return.ts"
      provides: "linkReturnScreen exempts /auth/continuar from the install gate (pass), marker or not"
      contains: "CONFIRM_CONTINUE_PATH"
    - path: "apps/web/e2e/mail.ts"
      provides: "followMailLink(page, link): goto the link, press the interstitial button"
      contains: "followMailLink"
  key_links:
    - from: "apps/web/app/auth/confirm/route.ts GET"
      to: "apps/web/app/(auth)/auth/continuar/page.tsx"
      via: "continueHref(): /auth/continuar?token_hash&type&next (307 from redirect())"
    - from: "apps/web/app/(auth)/auth/continuar/ConfirmForm.tsx"
      to: "apps/web/app/auth/confirm/route.ts POST"
      via: "native form POST to /auth/confirm, hidden fields token_hash/type/next, no token in the POST URL"
    - from: "apps/web/app/auth/confirm/route.ts POST"
      to: "apps/web/components/pwa/InstallGate.tsx"
      via: "303 -> full document load -> root layout reads link_return -> unchanged gate behaviour"
    - from: "apps/web/lib/link-return.ts linkReturnScreen"
      to: "apps/web/lib/auth-confirm.ts CONFIRM_CONTINUE_PATH"
      via: "path exemption so a gated phone can reach the button"
---

<objective>
Make `/auth/confirm` mail-scanner-proof. Production bug (2026-11-17, tenant igor-alves, social.drigoralves.com.br): a member with a Hotmail/Outlook address gets "link inválido" on BOTH the signup-confirmation and the password-recovery mail. Microsoft SafeLinks opens the link first, and `GET /auth/confirm` calls `verifyOtp` immediately, so the scanner burns the single-use token and the member's real click lands on `/esqueci-senha?erro=link-invalido` (or `/verifique-seu-email?erro=link-invalido`). She does not know her password, so recovery is her only way in.

Fix (entirely in apps/web; mail links keep their exact shape): a GET on `/auth/confirm` stops consuming the token. It redirects to a new interstitial page `/auth/continuar` (tenant shell, pt-BR, one button) that POSTs the same fields back to `/auth/confirm`; only that POST calls `verifyOtp`, writes `link_return` and redirects. Every other behaviour is preserved (open-redirect guard, OTP type allow-list, allow-list refusal branch, invite / signup / default fallbacks, link-return marker, the `/` forward in proxy.ts, invite links).

Output: shared pure helpers, a two-method route handler, the interstitial page + form + catalog namespace, an install-gate exemption for the interstitial, e2e helper and spec updates, one doc paragraph, green unit gates.

Why this shape (decided at planning time, with Next 16.3.5 docs and dist read):
1. Next forbids `route.ts` and `page.tsx` on one segment (route-handlers guide: "there cannot be a route.js file at the same route as page.js"). So the interstitial lives at `/auth/continuar` (public already through the `/^\/auth\//` entry of proxy.ts) and `route.ts` stays at `/auth/confirm` where the mail link, the GoTrue allow-list entry (`/auth/confirm**`), `auth-link-forward.ts` and the API tests all point.
2. POST is a plain route handler answering 303, NOT a Server Action. A Server Action redirect is a soft client navigation that does not reliably re-render the root layout, and the root layout is what reads the HttpOnly `link_return` cookie for `InstallGate`; after a soft navigation a phone would lose "abra o app pelo ícone" and, worse, the `/redefinir-senha` pass-through. A native form POST + 303 is a full document load, exactly like today's GET + 307, and works with JavaScript off. `redirect()` from next/navigation cannot be used in the POST (its route-handler status is 307, which a browser answers by re-POSTing the token to the destination), so the POST returns `new NextResponse(null, { status: 303, headers: { location: <relative path> } })`; Next merges the cookies written through `cookies()` into any returned Response (app-route module `appendMutableCookies`). GET keeps `redirect()` (307 is right for GET) and the existing test style.
3. The token travels in HIDDEN FIELDS of a native form, so the POST URL is plain `/auth/confirm` (no token in the request line, access logs or a Referer). The only URL that ever carries it is the one the mail already carries (GET `/auth/confirm?...` and its redirect to `/auth/continuar?...`). The value is a React-escaped input attribute; it is also in the RSC props of ConfirmForm, which is the same exposure as the URL itself.
4. CSRF: native form POSTs do not get Next's Server Action Origin check, so the handler gets a small positive-evidence guard (`isCrossSiteSubmission`). Evidence-only on purpose (refuse `Sec-Fetch-Site: cross-site` or a foreign `Origin` host; accept `Origin: null` and absent headers) so no real member is ever refused. Even without it the path would be no worse than today's GET.
</objective>

<repo_rules>
Standing rules for this repository; they apply to every task below.

1. Commits carry NO `Co-Authored-By: Claude` trailer and no "Generated with Claude" line (public repo, developer's standing rule; it overrides any default attribution text). Do not touch git config.
2. Stage and commit by explicit paths only: `git add <the named paths>` (new files need it) then `git commit -m "<msg>" -- <the same paths>`. Never `git add -A` / `git add .`. `.planning/STATE.md` and `.planning/ROADMAP.md` are modified in the working tree by someone else and many untracked files exist (`.claude/*`, `.planning/**`): never stage them. After each commit check `git show --stat HEAD` lists only the intended files. Code tasks do not commit anything under `.planning/` (the orchestrator commits PLAN.md, the SUMMARY and the STATE row).
3. Sequential execution on the main working tree (no worktrees). Do NOT run `pnpm db:reset`, `db:seed`, the integration suites or Playwright, and do not start `next dev` (it rewrites apps/web/AGENTS.md). No push, no deploy: the developer does that.
4. Read the Next 16 docs before writing Next code, as apps/web/AGENTS.md requires: apps/web/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md, 03-api-reference/04-functions/redirect.md, cookies.md, next-response.md, generate-metadata.md (the `referrer` field).
5. Never log the token: no console call, no error message and no thrown Error text in the new code may contain `token_hash`'s value.
6. Verification commands (run from the repo root unless noted): `pnpm --filter @rede-social/web exec vitest run <named files>` (a path containing parentheses must be quoted); `pnpm --filter @rede-social/web typecheck` (it is `next typegen && tsc --noEmit`, which also type-checks apps/web/e2e/*.ts because tsconfig includes `**/*.ts`; NOT `next build`); `pnpm boundaries`; `bash scripts/check-ui-literals.sh`; `pnpm exec biome check <touched files>` (use `--write` only for formatting, on touched files only). If one of them is unavailable or fails for a reason unrelated to the change, record that in the SUMMARY; never fabricate output. If a test file fails on a flake (the machine is shared), rerun that file alone twice before calling it real.
7. Mutable scope (#3786): the line numbers and call sites named below were read live at planning time but drift. Re-find every e2e call site yourself with `grep -n "page.goto\|waitForRecoveryMail\|waitForSignupMail\|latestMailMessage" <spec>` before editing; do not trust a line number.
</repo_rules>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.planning/STATE.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/apps/web/AGENTS.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/apps/web/app/auth/confirm/route.ts
@/Users/igorvboas/Library/Developer/TRIA/rede_social/apps/web/app/auth/confirm/route.test.ts
@/Users/igorvboas/Library/Developer/TRIA/rede_social/apps/web/lib/link-return.ts
@/Users/igorvboas/Library/Developer/TRIA/rede_social/apps/web/app/(auth)/layout.tsx
@/Users/igorvboas/Library/Developer/TRIA/rede_social/apps/web/app/(auth)/esqueci-senha/page.tsx
@/Users/igorvboas/Library/Developer/TRIA/rede_social/apps/web/app/(auth)/SubmitButton.tsx
@/Users/igorvboas/Library/Developer/TRIA/rede_social/apps/web/app/(auth)/comunidade-em-preparacao/page.test.tsx
@/Users/igorvboas/Library/Developer/TRIA/rede_social/apps/web/components/pwa/InstallGate.tsx
@/Users/igorvboas/Library/Developer/TRIA/rede_social/apps/web/e2e/mail.ts

Facts verified against the files while planning (do not re-derive):

- `route.ts` today: one `GET` that, for `token_hash` + allow-listed `type`, runs `createClient()` then `supabase.auth.verifyOtp({ type, token_hash })`; on success writes `link_return` through `linkReturnFor(type, safeNext)` + `linkReturnCookieOptions` and `redirect(safeNext)`; on error `isAllowlistRejection(error)` -> `redirect('/entrar?erro=nao-liberado')`; then the fallbacks (invite or `isAcceptInvitePath(safeNext)` -> `/convite-expirado`; `type === 'signup'` -> `/verifique-seu-email?erro=link-invalido`; default -> `/esqueci-senha?erro=link-invalido`). `sameOriginPath`, `isAcceptInvitePath`, `OTP_TYPES`, `isOtpType` and `DEFAULT_NEXT = '/inicio'` are module-private there.
- `lib/link-return.ts` is deliberately server+client safe (imports only `@/lib/supabase/cookie-options`); `linkReturnFor(type, safeNext)` returns 'invite' | 'recovery' | 'signup' | null and already encodes the invite rule (type invite OR next exactly /aceitar-convite) and 'email' -> signup, so the interstitial reuses it for its copy kind (null = magiclink = generic).
- `InstallGate` computes `linkReturnScreen(linkReturn, pathname)` only when the device is gated, and `blocked = gated && markerScreen !== 'pass' && ...`. With `marker === null` the function returns null today, so a phone outside the app would see the install screen instead of the interstitial (the marker is written only AFTER the button). `INSTALL_GATE` is read by app/layout.tsx (`env.INSTALL_GATE === 'on'`).
- `app/(auth)/layout.tsx` is the shell (brand tokens from the host via `getHostBrand`, `AuthBrand`, title from the tenant); a page at `app/(auth)/auth/continuar/page.tsx` serves URL `/auth/continuar` (route groups are not in the URL) and does not clash with `app/auth/*/route.ts`. It reads `searchParams` (async, a Promise in Next 16) so it is dynamic; `scripts/check-static-routes.sh` only needs every page under (auth) to stay dynamic.
- `lib/csp.ts` has `form-action 'self'`: a same-origin native form POST and a same-origin 303 satisfy it. The proxy's primary-host 308 happens before the route, so a mail link opened on an alias host reaches the primary host before the interstitial.
- `lib/route-handlers.inventory.ts` key `auth/confirm/route.ts` is `exempt` and `lib/route-handlers.inventory.test.ts` requires one entry per route.ts on disk: no new route.ts is added by this plan, so only the reason text changes.
- Catalog: one file per namespace in `apps/web/messages/pt-BR/<namespace>.json` with a single root key equal to the filename prefix; `scripts/check-ui-literals.sh` rejects JSX text with pt-BR diacritics and quoted `aria-label/placeholder/title/alt/label` literals in `.tsx`.
- e2e: only `signup.spec.ts`, `recovery.spec.ts`, `invite.spec.ts` follow a mail link (`page.goto(<link>)`); `phase2-smoke.spec.ts` only asserts the mail's content (`toContain(.../auth/confirm)`) and never navigates, so it needs NO edit. `e2e/mail.ts` has no Playwright import today. Bogus-token cases (`/auth/confirm?token_hash=bogus&type=...`) are valid-SHAPED links: they now reach the interstitial and fail only after the button is pressed.
- docs/deploy/auth-mail.md line ~80 describes `/auth/confirm` exchanging the hash; that paragraph needs one sentence.
- No CONTEXT.md decisions, no new requirement ids (quick task). Coverage audit: GOAL = SafeLinks no longer burns recovery/signup links (Tasks 1-3); REQ = none; RESEARCH = none; CONTEXT = the task brief's constraints (each mapped in must_haves). Deferred / out of scope: any mail-template or API change, a Server Action, session/auth refactors, touching packages/core, proxy.ts or auth-link-forward.ts.
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1 (tracer): the recovery link end to end — GET is inert, the interstitial renders, the POST consumes</name>
  <files>apps/web/lib/auth-confirm.ts, apps/web/lib/auth-confirm.test.ts, apps/web/app/auth/confirm/route.ts, apps/web/app/auth/confirm/route.test.ts, apps/web/app/(auth)/auth/continuar/page.tsx, apps/web/app/(auth)/auth/continuar/ConfirmForm.tsx, apps/web/app/(auth)/auth/continuar/page.test.tsx, apps/web/messages/pt-BR/confirmLink.json</files>
  <read_first>
    - apps/web/app/auth/confirm/route.ts and route.test.ts (the behaviour to preserve, and the mocks/`destination()` helper to extend)
    - apps/web/lib/link-return.ts (linkReturnFor, LINK_RETURN_COOKIE, linkReturnCookieOptions) and apps/web/lib/auth-link-forward.ts (untouched, read for the contract)
    - apps/web/app/(auth)/layout.tsx, apps/web/app/(auth)/esqueci-senha/page.tsx, apps/web/app/(auth)/SubmitButton.tsx (the look and token utility classes to copy)
    - apps/web/app/(auth)/comunidade-em-preparacao/page.test.tsx (page test with the REAL pt-BR catalog through createTranslator, and the 'must read nothing per request' mocks)
    - apps/web/messages/pt-BR/forgot.json (catalog shape) and apps/web/i18n/messages.ts header (one root key = filename prefix)
    - apps/web/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md, 03-api-reference/04-functions/redirect.md, cookies.md, generate-metadata.md (referrer)
  </read_first>
  <behavior>
    lib/auth-confirm.test.ts (pure):
    - sameOriginPath: '/redefinir-senha' and '/aceitar-convite?x=1' pass through as pathname+search; '', 'https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)' and a relative 'inicio' all return '/inicio'.
    - isOtpType accepts exactly recovery, email, signup, invite, magiclink; null, '' and 'nonsense' are false.
    - failureDestination(type, safeNext): type 'invite' or safeNext path exactly '/aceitar-convite' -> '/convite-expirado' (but '/aceitar-convite-x' and a query on another path are not invites); 'signup' -> '/verifique-seu-email?erro=link-invalido'; 'recovery', 'email', 'magiclink', null, 'nonsense' -> '/esqueci-senha?erro=link-invalido'.
    - sanitizeNext(raw): the same table as sameOriginPath but with no request origin (it resolves against the fixed reference origin 'http://confirm.invalid'): '/redefinir-senha' and '/aceitar-convite?x=1' pass, null, undefined, '', 'https://evil.example', '//evil.example', '/\\evil.example' and 'inicio' all return '/inicio'.
    - continueHref(tokenHash, type, safeNext): '/auth/continuar?token_hash=abc&type=recovery&next=%2Fredefinir-senha'; a token with '&', '=', '+', space and '"' round-trips through new URLSearchParams(href.split('?')[1]) unchanged.
    - isCrossSiteSubmission(headers, hosts): sec-fetch-site 'cross-site' -> true; 'same-origin' -> false; 'same-site' with a matching Origin host -> false; Origin host not among hosts -> true; Origin 'null' -> false; Origin unparseable garbage other than 'null' -> true; no relevant header -> false; empty hosts list -> false (fails open: nothing to compare); a host matches whichever of x-forwarded-host / host / nextUrl.host the caller passed.

    route.test.ts (extend the existing file; keep its mock style; make createClient a hoisted vi.fn so 'never created' is assertable):
    - GET is inert: for each of the five types with token_hash=abc the destination is '/auth/continuar?token_hash=abc&type=<t>&next=%2F...' (next=/redefinir-senha and next=/aceitar-convite kept, no next -> next=%2Finicio, next=https://evil.example -> next=%2Finicio, extra params dropped), and createClient, verifyOtp and the cookie setter are NOT called.
    - GET fallbacks unchanged and still Supabase-free: no token_hash with type=recovery -> '/esqueci-senha?erro=link-invalido'; token with type=nonsense -> same; no token with type=signup -> '/verifique-seu-email?erro=link-invalido'; no token with next=/aceitar-convite or type=invite -> '/convite-expirado'.
    - POST consumes: every pre-existing case is converted from GET query to POST form fields with the same expected destinations (IN-03 recovery-type invite lapse -> /convite-expirado, invite-type lapse, lapsed recovery, foreign next containing the invite path, signup lapse -> /verifique-seu-email?erro=link-invalido, successful signup -> /inicio, successful recovery-type invite -> /aceitar-convite, the allow-list block incl. 'wins over /convite-expirado' and the two 'keeps the old destinations' cases and the otp_expired case, and the whole link-return marker block: signup/recovery/invite writes with objectContaining httpOnly true, sameSite 'lax', path '/', maxAge 600 and no 'domain', failed exchange writes nothing, missing token or unknown type never writes). Each POST answer has status 303 and a RELATIVE location header; verifyOtp is called with exactly { type, token_hash }.
    - POST hardening: hidden-field next of '//evil.example', '/\\evil.example' and 'https://evil.example' on a valid exchange lands on '/inicio'; unknown type or empty token_hash never reaches verifyOtp and lands on the fallback; a body that is not form data (or is empty) lands on '/esqueci-senha?erro=link-invalido' with no Supabase call; the location header never contains the token_hash on any success or failure.
    - POST guard: 'sec-fetch-site: cross-site' -> 403 and no createClient/verifyOtp/cookie; an Origin of 'https://evil.example' -> 403; Origin 'null' and no Origin header -> accepted; an Origin equal to x-forwarded-host while the Host header differs -> accepted.

    page.test.tsx (real pt-BR catalog; next/navigation redirect stub throws 'REDIRECT:<to>'; @/lib/supabase/server and next/headers stubbed so any call fails the test):
    - recovery + next=/redefinir-senha -> a form with method post and action /auth/confirm, three hidden inputs token_hash/type/next carrying the values, ONE submit button named 'Escolher nova senha', heading 'Redefinir senha'.
    - signup and email -> button 'Confirmar e-mail'; type=invite and type=recovery with next=/aceitar-convite -> 'Aceitar convite'; magiclink -> 'Continuar'.
    - missing token_hash, unknown type -> redirect to failureDestination (the same three destinations as route.ts); a hostile next is rendered as '/inicio'; a token of 'a"><script>x</script>' is the exact value of the hidden input and the container holds no script element.
    - the page never touches Supabase, cookies or headers; searchParams as arrays take the first string.
    - ConfirmForm: a first submit event is not prevented and flips the button to its pending label (aria-busy); a second submit event IS prevented (double tap cannot post twice).
    - round trip (the tracer's end-to-end proof, in this file): GET handler on '/auth/confirm?token_hash=abc&type=recovery&next=/redefinir-senha' -> parse the thrown destination -> render the page with that query as searchParams -> read the three hidden inputs -> POST them to the route handler with a same-origin Origin header -> verifyOtp called once with { type: 'recovery', token_hash: 'abc' }, the link_return cookie written as 'recovery', answer 303 to '/redefinir-senha'.
  </behavior>
  <action>
    Write the tests above first, run them, and confirm the NEW cases fail for the right reason (RED: missing module / GET still consuming); record the failing summary lines in the SUMMARY verbatim, never invented. Then implement.

    1. `apps/web/lib/auth-confirm.ts` (new, pure: no server-only import, no console, a type-only import of EmailOtpType from @supabase/supabase-js). Move here, behaviour unchanged, from route.ts: `DEFAULT_NEXT`, `sameOriginPath(next, origin)` (keep the explanatory comment about the URL parser vs regex and the WHATWG backslash form), `isAcceptInvitePath`, `OTP_TYPES`, `isOtpType`. Add: `sanitizeNext(raw: string | null | undefined): string` (= `sameOriginPath(raw ?? '', 'http://confirm.invalid')`, a fixed reference origin used only as the URL parser's base for callers that have no request origin, i.e. the interstitial page), `CONFIRM_POST_PATH = '/auth/confirm'`, `CONFIRM_CONTINUE_PATH = '/auth/continuar'`, `failureDestination(type: string | null, safeNext: string): string` (the three-way fallback exactly as route.ts has it today: invite-or-accept-path, signup, default), `continueHref(tokenHash, type, safeNext)` built with URLSearchParams in the order token_hash, type, next, and `isCrossSiteSubmission(headers, hosts)` where `headers` is a Pick of the Headers `get` method and `hosts` is a readonly list of the request's own host strings (the caller passes the first x-forwarded-host value, the host header and request.nextUrl.host, dropping empties). Rules of isCrossSiteSubmission, evidence only: true when sec-fetch-site equals 'cross-site'; true when an Origin header is present, is not the literal 'null', and either does not parse as a URL or has a host that matches none of `hosts` (compare the `host` including port); otherwise false; false when `hosts` is empty. Document why 'same-site' is not refused on its own (the Origin host check covers a sibling subdomain, and Sec-Fetch-Site is absent in older Safari) and why 'Origin: null' is accepted (browsers send it on same-origin form POSTs from pages with a no-referrer policy and from some privacy contexts; the token is the credential, so a missing proof of origin is not proof of an attack).

    2. `apps/web/app/auth/confirm/route.ts`: import the helpers from '@/lib/auth-confirm' and remove the private copies (a Next route file may only export HTTP methods, which is why the helpers moved). Keep the long header comment but rewrite it to describe the new two-step contract (mail link GET is inert and hands off to /auth/continuar; the POST from that page consumes; why: SafeLinks and other scanners GET every link). Export exactly two functions.
       - `GET(request: NextRequest): Promise<never>`: read token_hash, type, next from `request.nextUrl.searchParams`, compute `safeNext = sameOriginPath(next ?? '', request.nextUrl.origin)`; when token_hash is non-empty and `isOtpType(type)`, `redirect(continueHref(tokenHash, type, safeNext))`; otherwise `redirect(failureDestination(type, safeNext))`. It must not import or call createClient, verifyOtp or cookies on this path. Keep `redirect()` here (307 is correct for GET) and keep it outside any try/catch (it works by throwing).
       - `POST(request: NextRequest): Promise<NextResponse>`: (a) build the host list from `request.headers.get('x-forwarded-host')` (first comma-separated value, trimmed, the same derivation proxy.ts step 1 uses), `request.headers.get('host')` and `request.nextUrl.host`; if `isCrossSiteSubmission(request.headers, hosts)` return a 403 NextResponse with a null body and Cache-Control no-store, before anything else; (b) `const form = await request.formData().catch(() => null)`, read `token_hash`, `type`, `next` accepting only values that are `typeof === 'string'` (a File is not a value); (c) `safeNext = sameOriginPath(next ?? '', request.nextUrl.origin)` — the guard is applied again because hidden fields are client-controlled; (d) when token_hash is non-empty and `isOtpType(type)`: `createClient()`, `verifyOtp({ type, token_hash })`; success -> `linkReturnFor(type, safeNext)` and, when non-null, `(await cookies()).set(LINK_RETURN_COOKIE, marker, linkReturnCookieOptions)`, then return the 303 to `safeNext`; error with `isAllowlistRejection(error)` -> 303 to '/entrar?erro=nao-liberado' (this branch still wins over the fallbacks); (e) everything else -> 303 to `failureDestination(type, safeNext)`. A small local helper builds every answer as `new NextResponse(null, { status: 303, headers: { location: <path>, 'cache-control': 'no-store' } })` with a RELATIVE path (the same shape `redirect()` emits; NextResponse.redirect demands an absolute URL and would tie the answer to whatever origin nextUrl reports behind Vercel). Do not use `redirect()` in POST. Write the cookie BEFORE building the answer. Nothing in POST may log, and no error text may carry the token.

    3. `apps/web/messages/pt-BR/confirmLink.json` (new; root key `confirmLink`, accents literal): `recovery` {title 'Redefinir senha', body 'Toque no botão abaixo para escolher uma nova senha.', action 'Escolher nova senha'}; `signup` {title 'Confirmar e-mail', body 'Toque no botão abaixo para confirmar o seu e-mail e entrar.', action 'Confirmar e-mail'}; `invite` {title 'Seu convite', body 'Toque no botão abaixo para abrir o seu convite.', action 'Aceitar convite'}; `generic` {title 'Continuar', body 'Toque no botão abaixo para continuar.', action 'Continuar'}; `note` 'Este passo extra protege o seu link contra leitores automáticos de e-mail.'; `pending` 'Continuando...'. These are the wording the tests assert; adjust the tests, not the meaning, if the executor refines a sentence.

    4. `apps/web/app/(auth)/auth/continuar/ConfirmForm.tsx` (new, 'use client'): props tokenHash, type, next, label, pendingLabel (strings already translated by the server page; no useTranslations here). Render `<form method="post" action="/auth/confirm">` (CONFIRM_POST_PATH) with three `<input type="hidden">` fields named token_hash, type, next, and `@rede-social/ui` `Button type="submit" variant="brand" size="lg" fullWidth` with `loading={pending}` showing `pendingLabel` while pending. Double-submit guard: a `useRef(false)` plus `useState(false)`; `onSubmit` returns early after `event.preventDefault()` when the ref is already true, otherwise sets the ref and the state and does NOT preventDefault (the native POST must go ahead; do not set the disabled state in an onClick). Must still work with JavaScript disabled (native form).

    5. `apps/web/app/(auth)/auth/continuar/page.tsx` (new, async server component, default export; export `const metadata: Metadata = { referrer: 'same-origin', robots: { index: false, follow: false } }` — the (auth) layout's generateMetadata supplies the title; add a comment that 'same-origin', not 'no-referrer', is deliberate because no-referrer makes Chromium and Firefox send 'Origin: null' on the form POST and the third-party stylesheet of TitleFontSheet must not receive the token URL). `searchParams` is a Promise (Next 16); normalise each of token_hash, type, next to its first string (arrays allowed) or undefined; `safeNext = sanitizeNext(next)` (the page has no request origin to compare with, so it uses the fixed-reference helper; the value that survives is already a path+search and was already sanitised once by the GET hop, this is the second, independent check). If token_hash is empty or `!isOtpType(type)`, `redirect(failureDestination(type ?? null, safeNext))`. Otherwise `kind = linkReturnFor(type, safeNext) ?? 'generic'` (reuse, do not re-implement the invite rule), load `getTranslations('confirmLink')`, and render, following esqueci-senha's structure and token utility classes only: a header block with h1 `t(`${kind}.title`)` (the key is built from the closed set recovery|signup|invite|generic, never from user input) and the body paragraph; `<ConfirmForm .../>` with `label={t(`${kind}.action`)}` and `pendingLabel={t('pending')}`; then the note as a small centred secondary-text paragraph. No hard-coded user-facing text anywhere (check-ui-literals). Calls no Supabase, no cookies(), no headers() in this file.

    Notes for the executor: the proxy.ts public list already contains the `/auth/` prefix (proxy.ts line ~34), so `/auth/continuar` and the POST to `/auth/confirm` reach signed-out visitors on tenant, generic and platform hosts without an edit; confirm that by reading, do not edit proxy.ts. Do not change lib/auth-link-forward.ts, packages/core, the API or the mail templates.

    Commit (after the verify command below is green): `git add` the eight paths, then `git commit -m "fix(auth): a GET on /auth/confirm no longer consumes the mail token; an interstitial POSTs it (SafeLinks)" -- <the eight paths>`. No Claude trailer; `git show --stat HEAD` must list only those files.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run lib/auth-confirm.test.ts app/auth/confirm/route.test.ts "app/(auth)/auth/continuar/page.test.tsx" i18n/messages.test.ts && pnpm --filter @rede-social/web typecheck && bash scripts/check-ui-literals.sh && pnpm boundaries && pnpm exec biome check apps/web/lib/auth-confirm.ts apps/web/lib/auth-confirm.test.ts apps/web/app/auth/confirm "apps/web/app/(auth)/auth/continuar" apps/web/messages/pt-BR/confirmLink.json</automated>
  </verify>
  <done>
    A GET with a valid-shaped link is provably side-effect free (route tests assert createClient, verifyOtp and the cookie setter uncalled) and lands on the interstitial; the interstitial renders the right button per kind with the token only as an escaped hidden value and calls nothing server-side; the POST is the only caller of verifyOtp and keeps every old destination, the marker cookie and the allow-list branch, answering 303 with a relative location that never carries the token; cross-site POSTs get 403; the round-trip test chains GET -> page -> POST for the recovery link. Vitest on the named files, web typecheck, check-ui-literals, boundaries and biome are green (report any that could not run). One path-scoped commit holds exactly the eight files. The e2e helper and install-gate exemption are not part of this task: until Task 2 lands, a phone behind INSTALL_GATE=on cannot reach the button, so nothing may be pushed between tasks.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: let a phone outside the installed app reach the interstitial (install-gate exemption) and refresh the route inventory reason</name>
  <files>apps/web/lib/link-return.ts, apps/web/lib/link-return.test.ts, apps/web/components/pwa/InstallGate.test.tsx, apps/web/lib/route-handlers.inventory.ts</files>
  <read_first>
    - apps/web/lib/link-return.ts (linkReturnScreen, underPath, the header comment on why the password forms are 'pass')
    - apps/web/lib/link-return.test.ts (cases 8 to 11 describe linkReturnScreen)
    - apps/web/components/pwa/InstallGate.tsx (markerScreen / blocked, lines ~265-280) and apps/web/components/pwa/InstallGate.test.tsx (stubbed device + mocked usePathname, how an existing 'pass' case is written)
    - apps/web/lib/route-handlers.inventory.ts (the auth/confirm/route.ts entry) and lib/route-handlers.inventory.test.ts (what it asserts)
  </read_first>
  <behavior>
    - linkReturnScreen(null, '/auth/continuar') is 'pass'; '/auth/continuar/' sub-paths are 'pass'; '/auth/continuar-x' and '/auth/confirm' are NOT exempt (null with no marker).
    - With each marker (signup, recovery, invite) '/auth/continuar' is 'pass' too (a stale marker must not hide the button).
    - The old cases stay as they are: no marker -> null on every other path; signup shows everywhere else; recovery passes on /redefinir-senha and below, shows elsewhere; invite passes on /aceitar-convite and below, shows elsewhere.
    - InstallGate component: an iPhone Safari 17 (gated, no escape) at pathname '/auth/continuar' with linkReturn null renders its children, not the install screen, and sets data-install-gate to 'open'; the same device at '/entrar' still shows the install screen (control).
    - The inventory still has exactly one entry per route.ts on disk (the existing inventory test stays green) and the auth/confirm entry's reason now describes both methods.
  </behavior>
  <action>
    Tests first (RED for the new linkReturnScreen and InstallGate cases), then implement.

    1. `apps/web/lib/link-return.ts`: import `CONFIRM_CONTINUE_PATH` from '@/lib/auth-confirm' (a pure module, so link-return stays client-safe) and make it the FIRST rule of `linkReturnScreen`: when `underPath(pathname, CONFIRM_CONTINUE_PATH)` return 'pass', before the `marker === null` early return. Extend the function's doc comment and the file header: the interstitial is the step that precedes the marker (the marker is written by the POST), so a gated phone would otherwise see the install screen in place of the only button that can finish the mail link; like the password forms it is a public, tokenised, session-less page, and the exemption is UX policy, not authorization (same stance as install-gate.ts). Do not touch `linkReturnFor`, `parseLinkReturn`, the cookie options or any marker rule.

    2. `apps/web/lib/link-return.test.ts`: update case 8 so it states 'no marker: no screen on any path except the confirmation interstitial' and add the new pins from the behavior list, numbering consistently with the file.

    3. `apps/web/components/pwa/InstallGate.test.tsx`: add the two component cases from the behavior list using that file's existing helpers (setDevice, the mutable pathname, the Provider, the real catalog); do not alter existing cases.

    4. `apps/web/lib/route-handlers.inventory.ts`: replace the `exempt` reason of key `auth/confirm/route.ts` with one that says: auth redirect; GET is inert (hands a token link to the /auth/continuar interstitial, calls nothing); POST exchanges a GoTrue e-mail link for a session and redirects same-origin only (open-redirect guard, OTP allow-list, cross-site refusal); calls no API route. Keep the key.

    Commit: `git add` the four paths, `git commit -m "fix(auth): the install gate lets a phone reach the /auth/continuar interstitial" -- <the four paths>`. No Claude trailer; `git show --stat HEAD` lists only those files.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run lib/link-return.test.ts components/pwa/InstallGate.test.tsx lib/route-handlers.inventory.test.ts lib/install-gate.test.ts && pnpm --filter @rede-social/web typecheck && bash scripts/check-ui-literals.sh && pnpm exec biome check apps/web/lib/link-return.ts apps/web/lib/link-return.test.ts apps/web/components/pwa/InstallGate.test.tsx apps/web/lib/route-handlers.inventory.ts</automated>
  </verify>
  <done>
    linkReturnScreen answers 'pass' for /auth/continuar and below with or without a marker and every pre-existing marker rule is unchanged; the InstallGate component test proves a gated phone sees the interstitial's children and still sees the install screen elsewhere; the route-handler inventory test passes with the refreshed reason; typecheck, check-ui-literals and biome are green. One path-scoped commit with exactly the four files.
  </done>
</task>

<task type="auto">
  <name>Task 3: make the e2e helper press the interstitial button, add the scanner regression cases, document the change</name>
  <files>apps/web/e2e/mail.ts, apps/web/e2e/recovery.spec.ts, apps/web/e2e/signup.spec.ts, apps/web/e2e/invite.spec.ts, docs/deploy/auth-mail.md</files>
  <read_first>
    - apps/web/e2e/mail.ts (extractConfirmLink, waitForRecoveryMail, latestMailMessage; no Playwright import yet)
    - apps/web/e2e/recovery.spec.ts, signup.spec.ts, invite.spec.ts: re-find every site that follows a mail link or a hand-written /auth/confirm URL with `grep -n "page.goto\|page2.goto\|waitForRecoveryMail\|waitForSignupMail\|latestMailMessage\|auth/confirm" <spec>` (live; do not trust line numbers)
    - apps/web/e2e/phase2-smoke.spec.ts (only to confirm it never navigates to the link: it asserts the mail body, so it needs no edit)
    - docs/deploy/auth-mail.md around the sentence that says `/auth/confirm` exchanges the hash (line ~80)
  </read_first>
  <action>
    1. `apps/web/e2e/mail.ts`: add `import type { Page } from '@playwright/test';` and export `followMailLink(page: Page, link: string): Promise<void>` that does `await page.goto(link)` and then clicks the one submit button of the interstitial form, located by `page.locator('form[action="/auth/confirm"] button[type="submit"]')` (stable across the four copy variants). Doc comment: a mail link now lands on the interstitial and the token is only consumed by the button (SafeLinks fix, quick 261117-kkx); use it for any link that is VALID-SHAPED (token_hash plus an allowed type), including deliberately bogus tokens, but not for links that must fall straight to a fallback (no token_hash, unknown type).

    2. Replace every `page.goto(<mail link>)` in the three specs with `await followMailLink(page, <link>)` (import it from './mail'): recovery.spec.ts (the round trip, the hijacked `next` cases with `//evil.example` and the backslash form, the rede-lab case, and every other site the grep finds that follows a link), signup.spec.ts (the confirm-then-profile case, the register -> Sair -> login case, the generic-host case) and invite.spec.ts (the first admin acceptance, the consumed link that must now land on `/convite-expirado` AFTER the button, both cases in the resend test where the old and the consumed link are opened on `page2`, and the accepted-link case). The deliberately bogus links typed by hand (`/auth/confirm?token_hash=bogus&type=recovery&next=https://evil.example` in recovery.spec.ts and `...type=signup...` in signup.spec.ts) also go through `followMailLink`, because they are valid-shaped and now stop at the interstitial first; their existing URL assertions (`/esqueci-senha?erro=link-invalido`, `/verifique-seu-email?erro=link-invalido`, host unchanged, alert text) stay as they are. Do not touch what `waitFor*` / `latestMailMessage` return.

    3. New regression coverage in the specs, local-stack-only like their neighbours (`test.skip(isRemote, ...)` where the neighbours do):
       - recovery.spec.ts, inside the round-trip case (the one titled with D-22) and BEFORE the real follow: fetch the link the way a scanner does with `page.request.get(link)` (no click, redirects followed by default), assert status 200 and that the body contains 'Escolher nova senha'; then follow with `followMailLink` and assert it still lands on `/redefinir-senha` and a new password still works. This is the case that proves SafeLinks no longer burns the link.
       - signup.spec.ts, inside the confirm-then-profile case, the same scanner GET before the real click, asserting the body contains 'Confirmar e-mail' and that the click still lands on `/inicio`.
       - recovery.spec.ts, one new short case: a link with NO token (`/auth/confirm?type=recovery&next=/redefinir-senha`) lands on `/esqueci-senha?erro=link-invalido` with the alert visible and zero buttons matching the interstitial form locator.
       Number the new case consistently with its neighbours and keep their comment style.

    4. `docs/deploy/auth-mail.md`: add one short paragraph next to the sentence that describes `/auth/confirm` exchanging the hash: the mail link opens an interstitial (`/auth/continuar`) and only the button's POST to `/auth/confirm` consumes the one-time token, because mail scanners (Microsoft SafeLinks, others) GET every link first; mail templates and the GoTrue allow-list entries (`/auth/confirm**`) are unchanged. pt-BR or English following that file's language.

    Verification honesty: Playwright needs the local Supabase stack, so these edits are verified by reading, `tsc` (apps/web tsconfig includes e2e) and biome only. State plainly in the SUMMARY that the specs were NOT run, unless you were actually able to run them, in which case report the real result.

    Finish: run the full final gate once over everything this plan touched (below), then write the SUMMARY at `.planning/quick/261117-kkx-mail-scanner-proof-auth-confirm-get-show/261117-kkx-SUMMARY.md` (status complete, the three commit SHAs, real RED and GREEN output, which gates ran, the note that e2e was not run, and that the working tree still has other people's STATE/ROADMAP edits unstaged). Do not commit anything under `.planning/`.

    Commit: `git add` the five paths, `git commit -m "test(auth): follow mail links through the /auth/continuar button; scanner regression cases" -- <the five paths>`. No Claude trailer; `git show --stat HEAD` lists only those files.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run lib/auth-confirm.test.ts lib/link-return.test.ts app/auth/confirm/route.test.ts "app/(auth)/auth/continuar/page.test.tsx" components/pwa/InstallGate.test.tsx lib/route-handlers.inventory.test.ts lib/auth-link-forward.test.ts && pnpm --filter @rede-social/web typecheck && bash scripts/check-ui-literals.sh && pnpm boundaries && pnpm exec biome check apps/web/e2e/mail.ts apps/web/e2e/recovery.spec.ts apps/web/e2e/signup.spec.ts apps/web/e2e/invite.spec.ts</automated>
  </verify>
  <done>
    No spec follows a mail link with a bare goto any more; followMailLink exists and is used by recovery, signup and invite specs; the scanner GET case exists for recovery and signup and the no-token case exists; phase2-smoke.spec.ts needed no edit; the doc paragraph is in. The e2e edits are verified by reading + tsc + biome and were NOT run (Playwright needs the local stack) unless the SUMMARY records an actual run. The whole unit gate (the seven vitest files above, typecheck, check-ui-literals, boundaries, biome) is green or any failure is recorded with its unrelated cause. One path-scoped commit holds exactly the five files; no push, no deploy.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| mail client / scanner -> GET /auth/confirm | Untrusted automated first visit (SafeLinks, antivirus, link previewers) carrying a live one-time token |
| browser -> POST /auth/confirm | Form fields (token_hash, type, next) are client-controlled; the request can also be forged cross-site |
| /auth/confirm -> Supabase Auth (verifyOtp) | The only state change: consumes the token, creates a session |
| redirect Location -> browser | `next` decides where the new session lands (open redirect) |
| interstitial HTML -> third parties | The token URL must not leak through Referer or a log |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-kkx-01 | Tampering | `next` in the mail link and in the hidden field (open redirect) | high | mitigate | sameOriginPath (URL-parser based, unchanged logic, moved to lib/auth-confirm.ts) runs at the GET hop AND again on the POST input; tests cover `//evil.example`, `/\evil.example`, `https://evil.example`; only a relative path+search is ever emitted |
| T-kkx-02 | Tampering | `type` hidden field forged to an unlisted OTP type | medium | mitigate | `isOtpType` allow-list re-applied in POST and in the page; unknown type never reaches verifyOtp (tested) |
| T-kkx-03 | Spoofing | Cross-site forged POST consuming an attacker's token in the victim's browser (login CSRF), and today's GET equivalent via an img tag | medium | mitigate | `isCrossSiteSubmission` refuses `Sec-Fetch-Site: cross-site` and a foreign Origin host with 403 before Supabase is touched; the new path is strictly stricter than the GET it replaces; `Origin: null` and absent headers are accepted on purpose (see T-kkx-07) |
| T-kkx-04 | Information disclosure | The token in logs, Referer, a Location header or unescaped HTML | high | mitigate | No logging in the new code; hidden field value is a React-escaped attribute; POST URL carries no token (fields are in the body); POST Location never contains it (asserted); page metadata `referrer: same-origin` keeps the token URL out of cross-origin Referer (the tenant font stylesheet is the only third party) and `noindex`; deliberately NOT no-referrer, which makes browsers send `Origin: null` on the POST |
| T-kkx-05 | Elevation of privilege | Interstitial exempted from the install gate | low | accept | UX policy, not authorization (install-gate.ts stance): the page is public, tokenised and creates nothing until the POST; same treatment the password forms already get |
| T-kkx-06 | Denial of service | A scanner that executes JS or submits forms and so still burns the token | medium | accept | Not distinguishable from a real user; the known scanners (SafeLinks, antivirus fetchers) only GET. Residual risk recorded; if a tenant still reports burnt links, the next step is a code the member types, which is out of scope here |
| T-kkx-07 | Spoofing | `Origin: null` / missing Origin POST accepted | low | accept | A forged request needs the victim's browser AND a token the attacker holds, which only yields a session for the attacker's own account, the same exposure the old GET had; refusing null would break legitimate privacy-context submits |
| T-kkx-08 | Tampering | Double submit (two POSTs) leaving the member on the error page after a success | low | mitigate | ConfirmForm blocks the second submit with a ref guard; also the link is single-use so a second POST cannot sign anyone else in |
</threat_model>

<verification>
- `pnpm --filter @rede-social/web exec vitest run lib/auth-confirm.test.ts lib/link-return.test.ts app/auth/confirm/route.test.ts "app/(auth)/auth/continuar/page.test.tsx" components/pwa/InstallGate.test.tsx lib/route-handlers.inventory.test.ts lib/auth-link-forward.test.ts i18n/messages.test.ts`
- `pnpm --filter @rede-social/web typecheck`, `pnpm boundaries`, `bash scripts/check-ui-literals.sh`, `pnpm exec biome check` on every touched file.
- Static reads: proxy.ts public list still holds `/^\/auth\//` and is unedited; packages/core, the API and lib/auth-link-forward.ts have no diff (`git diff --stat <base>..HEAD -- packages apps/api apps/web/proxy.ts apps/web/lib/auth-link-forward.ts` is empty).
- Not run, by design: Playwright (needs the local stack), `pnpm check:static-routes` (needs a production build; the page reads searchParams so it stays dynamic), db:reset, integration suites.
- Manual check for the developer after deploy (not part of this plan): open a real recovery mail link on a Hotmail/Outlook address, confirm the interstitial shows, press the button, land on the password form.
</verification>

<success_criteria>
A mail scanner's GET on any `/auth/confirm` token link no longer consumes it: the unit tests prove GET calls nothing and hands off to the interstitial, the interstitial renders the right branded button per link kind, and only the POST calls `verifyOtp`, writes `link_return` and redirects (303, relative, token-free), keeping every pre-existing destination, guard and the invite flow. A phone outside the installed app can still reach the button. Mail links, proxy.ts, the API and packages/core are untouched. E2E helpers and specs press the button and include a scanner-first regression case, verified by reading and tsc only. Three path-scoped commits, no Claude trailer, nothing pushed or deployed.
</success_criteria>

<output>
Create `.planning/quick/261117-kkx-mail-scanner-proof-auth-confirm-get-show/261117-kkx-SUMMARY.md` when done.
</output>
