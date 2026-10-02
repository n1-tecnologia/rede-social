# Phase 8 real-device checklist (the D-345 go-live pass)

**Purpose.** One consolidated list of everything the pilot go-live still owes a real phone: this
phase's admin flows on a phone (ADMIN-04, ROADMAP Phase 8 SC 3), PWA install and push, every
real-device row earlier phases deferred to this pass, and the CSP report-only read that allows the
flip to `enforce`. Local and CI runs cannot prove any of it: phones cannot reach `*.localhost`,
push runs `PUSH_TRANSPORT=fake` there, video runs `VIDEO_PROVIDER=fake`, and Playwright's Chromium
with a phone viewport is not a phone. So every row runs **against production**, on the `qa`
tenant, after the release steps in
[`docs/DEPLOY.md` → "Phase 8 release"](DEPLOY.md#phase-8-release-moderation-tenant-admin-panel-csp)
(this checklist is release step 5).

**Rule.** Every row starts as `Status: blocked — not run` and stays that way until a person runs it
on the named real device and records the outcome here and in the Phase 8 UAT
(`/gsd-verify-work 8`). No automated result, emulator, simulator, or desktop browser with a phone
user agent counts as a pass for any row, and no plan records a pass on the developer's behalf
(08-12, T-08-59). A row run only on desktop stays `blocked`, with a note saying so.

## Prerequisites

- Production on the Phase 8 release: `docs/DEPLOY.md` "Phase 8 release" steps 1-4 done (the
  migrations, the web with `CSP_MODE=report-only`, then the API and worker, then the `qa` tenant).
- The **`qa` tenant**, created through the platform panel (`/plataforma/novo`), separate from
  socializando, igor-alves-teste and reine, with `feed`, `communities`, `stories`, `events`,
  `notifications` and `chat` on (and `reels`, for the Reels rows), and three accounts:
  - **qa admin** (`admin_tenant`, the first-admin invite);
  - **qa member** (signs up on the `qa` host, or is invited);
  - **qa support** (a second member promoted to "Suporte" from Membros, row A9).
  A second **qa member** account helps with the block rows (A8, C26). A verified custom domain for
  `qa` needs a DNS name from the developer (RESEARCH A8). Without one, the host-dependent rows (B1-B2
  install and push on the tenant's own host, C3) are run on whatever host the `qa` tenant has, or stay
  blocked with that reason.
- Devices:
  - a real **iPhone on iOS 16.4 or later** (Safari, then the Home Screen app);
  - a real **Android phone with Chrome**;
  - a real **iPad** for the Phase 7 rows that name it (C11, C12);
  - a **desktop Chrome** for the second side (the admin while the phone is the member, the staff
    inbox, the Vercel logs).
- Test media: a JPEG photo, a short phone video (for C7 and the Reels rows), a real public
  **YouTube** URL and a real public **Vimeo** URL (A15).
- Resetting a device's push state: see `docs/phase-07-device-test-plan.md` "Resetting the push
  state on a device".

## A. This phase's admin flows, from a phone (ADMIN-01..04, MODER-01..03)

Run each row on the iPhone AND on the Android phone, signed in as the qa admin unless the row says
otherwise. "At 320px and 768px" (ADMIN-04 adjacency) means: on the phone in portrait, and on the
iPad or the phone in landscape near the 768px `md` boundary. In every form row, open the on-screen
keyboard on each field: no control may hide behind the keyboard or the BottomNav.

| # | Device | Steps | Expected | Status |
|---|---|---|---|---|
| A1 | iPhone + Android | On Início, tap the floating create control. Try "Publicar" with nothing typed. Then write a caption, add one photo, and publish. | Empty: "Publicar" stays disabled and nothing is created. Filled: the post opens with "Publicação criada." and heads Início's feed. The keyboard never covers the caption field or "Publicar" (ADMIN-04 SC 3, empty, ordering, adjacency). | Status: blocked — not run |
| A2 | iPhone + Android | Tap the "Publicar um story" circle. Submit with no media (Enter in the caption field). Then pick a photo, write a caption, and publish. | Empty: "Escolha uma foto ou um vídeo para publicar." shows and nothing is created. Filled: back on Início with "Story publicado.", and the tenant circle plays it as its newest story. | Status: blocked — not run |
| A3 | iPhone + Android | Comunidades → "Criar comunidade". Try submitting with an empty name. Then name it, add a cover photo, and create. | Empty: "Criar comunidade" stays disabled. Filled: lands on the new community page, which heads the Comunidades list. | Status: blocked — not run |
| A4 | iPhone + Android | Eventos → "Criar evento". Try submitting empty. Then create an in-person event with a cover for tomorrow, and an online one with a meeting link. | Empty: the submit stays disabled. Filled: "Evento criado.", and the earliest-starting event heads Próximos. The date and time pickers are the phone's native ones and usable. | Status: blocked — not run |
| A5 | iPhone + Android | Configurações → Marca. Upload a logo, change the primary and secondary colours while watching both preview frames, and save. Then change the display name and tap "Salvar nome". | The preview follows each typed colour live. "Alterações salvas." then "Nome salvo.". The next screen shows the new colour and name, the icons card reaches "Ícones gerados", and a typed colour survives the icon refresh. | Status: blocked — not run |
| A6 | iPhone, Home Screen app (installed BEFORE A5) | After A5, close the installed app completely and reopen it from the Home Screen. Repeat on Android (installed app). | The installed app picks up the new name, colour and icon on its next launch. An OS may cache the icon longer; record how long it took (08-06 coverage, UI E12/partial). | Status: blocked — not run |
| A7 | iPhone + Android | Configurações → Membros. Search a member by part of their e-mail, then use the chips (Todos, Ativos, Bloqueados, Convidados). | Search narrows the list as you type, the chips filter it, and long names and e-mails ellipsize at the phone's width without pushing the chevron off the row. | Status: blocked — not run |
| A8 | iPhone (admin) + Android (second qa member, app OPEN on Início) | From Membros, open the second member's row, tap "Bloquear acesso", write a reason, and confirm "Bloquear". Watch the member's phone without touching it. Then "Desbloquear acesso" and sign the member in again. | The admin gets "Acesso de {name} bloqueado." and the "Bloqueado" pill. The member's OPEN app lands on "Acesso suspenso" on its own within seconds, and shows no reason. After unblocking, the member signs in normally (MODER-02). | Status: blocked — not run |
| A9 | iPhone | From Membros, change a member's role to "Suporte", read the confirm, and confirm. Then revert to "Membro". | The confirm names the role's effect, "Papel de {name} alterado para Suporte." shows, and the sheet stays open on the new role. The member's next Configurações load shows or hides the staff rows accordingly. | Status: blocked — not run |
| A10 | iPhone | Open a member's profile, tap the "⋯" admin control in the profile header, and block from there (08-05 E07/partial). | The sheet opens above the TopBar (nothing intercepts the taps), the block lands on Membros filtered to "Bloqueados" with the toast, and the member's profile is gone. Unblock afterwards. | Status: blocked — not run |
| A11 | iPhone + Android | As the qa member, comment on a post and reply to that comment from a second account. As the admin, tap the trash control on the member's root comment and confirm the moderation dialog. | The root and its replies disappear together, the count drops by 1 + replies, "Comentário removido." shows, and the member gets no notification about it (MODER-01, D-335). | Status: blocked — not run |
| A12 | iPhone + Android | The same removal on a comment under a Reel, and on a comment under a story (open the story's comment sheet). | The same outcome on both surfaces; the story keeps playing state correctly after the sheet closes. | Status: blocked — not run |
| A13 | iPhone + Android | Configurações → Moderação. Use the chips, scroll to load more, and pull to refresh. | Every act from A8-A12 is listed newest first with who, whom, when (tenant time), the comment excerpt and the block reason. Nothing can be edited or deleted. The screen reads well at the phone's width (08-01 coverage D7). | Status: blocked — not run |
| A14 | iPhone (admin) + Android (signed OUT) | Configurações → Regras da comunidade: edit the text (two paragraphs), use "Ver como os novos membros veem", and save. On the signed-out phone, open `/cadastro` on the qa host and tap "ver regras". | "Regras salvas. Valem para quem entrar a partir de agora.", the version goes up by one, and the signed-out phone reads exactly the new text, with paragraph breaks kept (ADMIN-03). | Status: blocked — not run |
| A15 | iPhone + Android | As the admin, publish a post containing a real YouTube link and another with a real Vimeo link. As the member, tap play on each card. | Before the tap, nothing loads from YouTube or Vimeo. After the tap, the video plays inline in the card with no "Error 153" (referrer policy) and no CSP violation in the Vercel logs (08-08 coverage D8, UI E15). | Status: blocked — not run |
| A16 | iPhone + Android | Repeat A1-A4 with the phone in landscape (around 768px wide) and on the iPad. | Each form completes with the keyboard open; no control hides behind the keyboard or the BottomNav (ADMIN-04 adjacency at the `md` boundary). | Status: blocked — not run |
| A17 | Desktop Chrome (platform host, super_admin) | Open `/inicio` on the platform host and read the tenant list. | Each row reads "{slug} — {name} ({modules})" with correct punctuation (08-11 coverage D6, the `platform.tenantRow` move). Desktop is fine here: this row is a visual read, not a device row. | Status: blocked — not run |

## B. PWA install and push

| # | Device | Steps | Expected | Status |
|---|---|---|---|---|
| B1 | iPhone (iOS 16.4+), Safari | Open the qa host, Share → Add to Home Screen, then launch from the Home Screen. | Launches without browser chrome, shows the qa tenant's name and derived icon (maskable, not cropped), the status bar in the tenant colour, and `data-display-mode` reads `standalone` (PWA-01). | Status: blocked — not run |
| B2 | Android, Chrome | Open the qa host and install the app from Chrome's prompt or menu; launch it. | The same as B1 on Android. | Status: blocked — not run |
| B3 | iPhone Home Screen app + Android installed app | As the qa member, Configurações → push row → "Ativar", grant, close the app. As the admin, publish a post. | The prompt appears only after the tap. A banner with the tenant's name and icon arrives on both phones, and tapping it opens the post (NOTIF-03). | Status: blocked — not run |
| B4 | iPhone Safari (NOT installed) | As the qa member, tap "Ativar" on the push row. | The install sheet opens instead of an OS prompt; the switch stays off (PWA-02). | Status: blocked — not run |

## C. Every deferred real-device row

Each row names its source; the source document keeps its own wording and its own record.

| # | Source | Device | Steps | Expected | Status |
|---|---|---|---|---|---|
| C1 | 02-UAT test 2 (PWA-01) | iPhone + Android | As B1/B2, on a tenant host over HTTPS; read `document.documentElement.dataset.displayMode` in the inspector. | Standalone, the tenant's name and maskable icon, theme-color in the tenant primary, `data-display-mode === 'standalone'`. | Status: blocked — not run |
| C2 | 02-UAT test 3 (TENANT-07) | Desktop Chrome + DNS | Attach a real customer host (the qa DNS name) from Domínios, create the DNS records, verify; then force one provider failure and restore. | As written in 02-UAT test 3: Vercel domain, auth allow-list entry, by-host 404 then 200, branded `/entrar`, invite mail; the forced failure shows `last_error` and re-verifies on the next run. | Status: blocked — not run |
| C3 | 02-UAT test 4 (TENANT-06) | Any phone (mail client) | Request a password recovery on the qa host and an invite for a new admin. | Both mails arrive through Resend with the tenant's name, logo and colour and the platform footer. | Status: blocked — not run |
| C4 | 02-UAT test 5 | GitHub Actions (not a device) | Covered by "Phase 8 release" step 7: one CI run that finishes. | The `ci.yml` jobs run in order and finish inside their limits; on a forced failure both Playwright report folders upload. | Status: blocked — not run |
| C5 | 04-UAT test 2 (recorded pass in 04-UAT; re-run on production) | iPhone + Android | As a qa member, open a post and tap share; send the link to yourself and open it signed out. | The OS share sheet opens with `/post/{id}` on the tenant host; after login the link returns to the post. | Status: blocked — not run |
| C6 | 04-UAT test 3 (recorded pass in 04-UAT; re-run on production) | iPhone + Android | Double-tap a post's image, including one already liked; swipe the gallery through and back. | The like count moves exactly once per double tap (note the A-WR-08 already-liked case); the dots follow the active slide. | Status: blocked — not run |
| C7 | 04-UAT test 4 (blocked: third-party) | iPhone + Android | As the qa admin, publish a video post from the phone's camera roll and follow it until it plays. | The card shows the processing state, then plays (real Mux transcoding and HLS on a real phone). | Status: blocked — not run |
| C8 | 05.2-UAT test 1 | iPhone + Android (two phones for step 6) | The six steps of 05.2-UAT test 1: Início and community highlights from "Gerenciar", publish from a community's `+`, add an expired story from "Seus stories" and from "Destacar", reorder by DRAGGING the handle, re-cover with an uploaded image, confirm the migrated "Destaques", and the seen ring across two phones. | Each step behaves as in the e2e replay; dragging the handle reorders without scrolling the page; the order persists after a reload; the ring is neutral after load on the second phone, turns brand after a new publish, and resumes at the new story. | Status: blocked — not run |
| C9 | 05.3-UAT test 1, WINDOWS #48, REELS-06 | iPhone Home Screen app + Android Chrome | Open Reels with sound off; tap "Ativar som"; swipe through several videos; trigger a refused unmuted play (lock and unlock, or Low Power Mode). | The first video autoplays muted; sound stays on across swipes after "Ativar som" for the visit (never persisted); a refused unmuted play falls back to muted with the icon flipped; a tap or Space pauses; the video pauses while the comment sheet is open or the app is hidden (REELS-06). | Status: blocked — not run |
| C10 | 05.3-UAT test 1, WINDOWS #49 | iPhone + Android | Swipe diagonally, swipe twice quickly, tap once, double-tap, and do the WR-05 two-finger heart tap. | A diagonal swipe changes video or lane, never both; two quick swipes never read as a like; a tap pauses after about 300 ms; a double tap likes without pausing; the two-finger tap likes without changing video or lane. | Status: blocked — not run |
| C11 | 05.3-UAT test 1, WINDOWS #50 (real Mux) | iPhone + Android | Swipe to an already-loaded video; stay on one video past a token refresh (WR-06, about 110 min) if time allows. | The first frame or poster shows with no black flash; no freeze on a token swap. | Status: blocked — not run |
| C12 | 05.3-UAT test 1, WINDOWS #51 | iPhone + Android | Play a video with a bright frame. | The rail, caption and lane labels stay legible, judged against sketch 005. | Status: blocked — not run |
| C13 | Phase 7 device plan row 1 | iPhone Safari (not installed) | See `docs/phase-07-device-test-plan.md` row 1. | As written there. | Status: blocked — not run |
| C14 | Phase 7 device plan row 2 | iPad Safari | Row 2. | As written there. | Status: blocked — not run |
| C15 | Phase 7 device plan row 3 | iPhone Home Screen app | Row 3. | As written there. | Status: blocked — not run |
| C16 | Phase 7 device plan row 4 | iPhone + Android (apps closed) | Row 4. | As written there. | Status: blocked — not run |
| C17 | Phase 7 device plan row 5 | Android Chrome | Row 5. | As written there. | Status: blocked — not run |
| C18 | Phase 7 device plan row 6 | Android Chrome (app focused) | Row 6. | As written there. | Status: blocked — not run |
| C19 | Phase 7 device plan row 7 | Android Chrome (app closed) | Row 7. | As written there. | Status: blocked — not run |
| C20 | Phase 7 device plan row 8 | iPhone or Android | Row 8 (the 1 h event reminder). | As written there. | Status: blocked — not run |
| C21 | Phase 7 device plan row 9 | iPhone + Android | Row 9 (a 2,000-character staff reply). The staff side can now be the qa support account (Phase 8 roles). | As written there. | Status: blocked — not run |
| C22 | Phase 7 device plan row 10 | Staff device | Row 10. | As written there. | Status: blocked — not run |
| C23 | Phase 7 device plan row 11 | iPhone Home Screen app + desktop installed app | Row 11 (app-icon badge). | As written there. | Status: blocked — not run |
| C24 | Phase 7 device plan row 12 | iPhone Home Screen app | Row 12 (composer above the keyboard). | As written there. | Status: blocked — not run |
| C25 | Phase 7 device plan row 13 | iPhone or Android | Row 13 (logout deletes the subscription). | As written there. | Status: blocked — not run |
| C26 | Phase 7 device plan row 14 | Android Chrome (second qa member) | Row 14, using Phase 8's block action from Membros instead of the SQL. | As written there. | Status: blocked — not run |
| C27 | Phase 7 device plan row 15 | Android Chrome | Row 15 (dead endpoint cleanup). | As written there. | Status: blocked — not run |
| C28 | Phase 7 device plan row 16 | iPhone, Android, iPad | Row 16 (push host allow-list). | As written there. | Status: blocked — not run |
| C29 | Phase 7 device plan row 17 | iPhone + Android | Row 17 (bell, Notificações, threads and staff inbox at phone width). | As written there. | Status: blocked — not run |
| C30 | 07-UAT test 2 (blocked member with an open socket) | Android Chrome (qa member) + desktop (admin) | With the member's app OPEN on Início, and in a second run on `/suporte`, block the member from Membros. | No new Realtime join succeeds; the open socket goes quiet no later than its next token push or re-join (at most 3600 s); API reads are refused and the app moves to "Acesso suspenso"; the push subscriptions are gone at the next send. | Status: blocked — not run |

## D. The CSP report-only check (D-346)

| # | Device | Steps | Expected | Status |
|---|---|---|---|---|
| D1 | Desktop (Vercel CLI) | With `CSP_MODE=report-only` on production, after sections A-C have run, read the logs with the DEPLOY.md filter: `vercel logs --project prj_oPNJ2NKXw4j2RkAN4gtC8vbmqyZa --environment production --no-branch --json --no-follow`, narrowed with `--since`/`--until` to the test window, and keep only the `csp.violation` lines. | Zero `csp.violation` lines from the app (browser-extension hosts and `chrome-extension` are noise; note them, they do not block). Any app line names its directive and blocked host: that is a fix before the flip, not a pass. | Status: blocked — not run |
| D2 | Desktop (Vercel) | Only if D1 is clean: set `CSP_MODE=enforce` on production and redeploy ("Phase 8 release" step 6). | The response headers show `Content-Security-Policy` (not `-Report-Only`). | Status: blocked — not run |
| D3 | iPhone + Android | After D2, the smallest smoke on one phone each: sign in, feed, a video, tap an inline YouTube player, open Suporte. | Everything works and the logs show no new `csp.violation` line. On any break, roll back to `report-only` (DEPLOY.md). | Status: blocked — not run |

## Recording

For each row, replace `blocked — not run` with `passed` or `failed — <what happened>`, and add the
device model, the OS and browser versions, and the date. Rows not run stay `blocked — not run` and
never become passes; a row run only on a desktop browser stays blocked with that note. The results go
to the Phase 8 UAT (`/gsd-verify-work 8`), and the source rows of section C are updated in their own
documents (02/04/05.2/05.3/07 UAT, `docs/phase-07-device-test-plan.md`, the WINDOWS ledger rows
48-51 and REELS-06 in `.planning/REQUIREMENTS.md`). A failing row is a gap for
`/gsd-plan-phase --gaps`, not something to fix in place.

**The `qa` tenant's lifecycle.** It stays active until the 08.1 exit gate's short real-device smoke
closes the MVP. Then it is suspended through the platform panel's status toggle (reversible) and
never hard-deleted.
