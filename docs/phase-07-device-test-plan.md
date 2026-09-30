# Phase 7 real-device test plan (notifications, Web Push, chat)

**Purpose.** The Phase 7 behaviours that no automated run can prove: a real push delivered by a real
push service (FCM, Apple, Mozilla), the iOS 16.4+ Home Screen gate, what the operating system draws
(the banner, its title and icon, the tag that replaces a banner, the app-icon badge), and the
software keyboard. Local and CI runs use `PUSH_TRANSPORT=fake` and a mocked `PushManager`
(`apps/web/e2e/push.spec.ts`, `phase7-smoke.spec.ts`), and phones cannot reach `*.localhost`, so
every row below runs **against production** after the release steps in
[`docs/DEPLOY.md` → "Phase 7 release"](DEPLOY.md#phase-7-release-notifications-web-push-chat).

**Rule.** Every row starts as `Status: blocked — not run` and stays that way until a person runs it
on the named device and records the outcome here and in the Phase 7 UAT (`/gsd-verify-work`). No
automated result, emulator or desktop browser with a phone user agent may be recorded as a pass for
any row (plan 07-11, orchestrator note 8).

## Prerequisites

- Production deployed through the Phase 7 release steps 1-7: the three VAPID secrets, Vercel's
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, Realtime `private_only`, the API and worker live before the web.
- A test tenant (or the pilot tenant) with the `notifications`, `chat`, `feed` and `events` modules
  on, reached on its HTTPS host, with:
  - a **member** account (the device under test signs in with it);
  - a **support-capable** account: the tenant's `admin_tenant` (production has no `support_tenant`
    user until Phase 8, D-223), signed in on a second device or a desktop browser;
  - the ability to publish a post and create an event as that admin.
- Devices:
  - a real **iPhone on iOS 16.4 or later** (Safari, then the Home Screen app);
  - a real **iPad** (iPadOS Safari, which sends a desktop-class user agent);
  - a real **Android phone with Chrome**.
- A desktop Chrome for the staff side and the desktop app-badge row.

**Resetting the push state on a device** (before a row that needs a fresh start):

- iPhone / iPad: delete the Home Screen app (this removes its subscription and its permission), then
  Settings → Safari → Advanced → Website Data → remove the tenant host. Re-add to the Home Screen.
- Android Chrome: site settings for the tenant host → Notifications → Reset permission, then
  Clear & reset; or uninstall the installed app.
- Desktop Chrome: the padlock → Site settings → Notifications → Reset.
- On the server side, turning the switch off in Configurações (or logging out) deletes that
  device's `push_subscriptions` row.

## Rows

| # | Device | Steps | Expected | Status |
|---|---|---|---|---|
| 1 | iPhone, Safari (not installed) | Sign in as the member. Open Configurações and tap "Ativar" on the push row. Then open Notificações and tap the soft-ask card's CTA. | Both open the install sheet (the InstallHint push variant: add to the Home Screen to receive notifications). No OS permission prompt appears, and the switch stays off (UI E07, PWA-02, D-234). | Status: blocked — not run |
| 2 | iPad, Safari (desktop-class UA) | The same as row 1 on the iPad. | The same as row 1: the install sheet, never the prompt. The desktop-class UA is still treated as iOS (UI E07/partial). | Status: blocked — not run |
| 3 | iPhone, Home Screen app (iOS 16.4+) | Safari → Share → Add to Home Screen. Open the app from the Home Screen, sign in, open Configurações and tap "Ativar". Grant. | The OS permission prompt appears only after the tap (never on load, D-233). After granting, the row reads "Ativadas neste aparelho." and one subscription exists for this device. | Status: blocked — not run |
| 4 | iPhone (Home Screen app, closed) and Android Chrome (app closed) | As the admin, publish a new post in the feed. | Each device shows a banner whose title is the tenant's display name and whose icon is the tenant's 192 px icon; tapping it opens that post (NOTIF-03, D-232, D-236). | Status: blocked — not run |
| 5 | Android Chrome (app closed) | As the admin, publish a second post before opening the first banner. | The second banner replaces the first instead of stacking (the per-kind tag, D-236). Note on iOS whether Safari honours the replacement (RESEARCH A6). | Status: blocked — not run |
| 6 | Android Chrome, app open and focused | With the app in the foreground on Início, publish a post as the admin. | No OS banner appears; the bell badge updates live (UI E14/partial, A5). | Status: blocked — not run |
| 7 | Android Chrome, app closed | Close the app completely, then publish a post as the admin. | The banner appears (the foreground quiet of row 6 applies only to a focused window). | Status: blocked — not run |
| 8 | iPhone Home Screen app or Android Chrome | As the admin, create an event starting in about 70 minutes. As the member, answer "Vou". Wait for the 1 h window. | About an hour before the start, a reminder banner arrives and opens the event; the bell has an actor-less reminder row (EVENT-07). | Status: blocked — not run |
| 9 | iPhone Home Screen app and Android Chrome | As the member, write to Suporte. From the staff account, reply with a 2,000-character message. | The banner's title reads "Equipe {tenant}" and its body is cut with "…" (UI E14/long-text, D-235); tapping it opens the member's thread, where the full message is shown. | Status: blocked — not run |
| 10 | Staff device (desktop Chrome or a phone with push on for the staff account) | As the member, send a new message to Suporte. | The staff device gets "Nova mensagem de {member}"; tapping it opens that conversation in the inbox (D-235). | Status: blocked — not run |
| 11 | iPhone Home Screen app and desktop Chrome (installed app) | Leave one unread notification and one staff reply unread, then background the app. | The app-icon badge shows the bell count plus the chat count (D-239), and clears as they are read. | Status: blocked — not run |
| 12 | iPhone Home Screen app | Open Suporte with a long thread and tap the composer. | The composer lifts above the keyboard with the latest message still visible, and the floating BottomNav never covers the field (UI E10/partial). | Status: blocked — not run |
| 13 | iPhone Home Screen app or Android Chrome | Log out from Configurações, then publish a post as the admin. | No banner reaches this device: logout deleted its subscription first (07-07). | Status: blocked — not run |
| 14 | Android Chrome (a second member account) | Block the member: Phase 8's block action, or for the pilot the documented SQL as the migration role, `update public.memberships set status = 'blocked', blocked_at = now() where tenant_id = '<tenant>' and user_id = '<user>';`. Then publish a post and reply to their thread. | No banner and no live update reach the blocked member; their subscriptions are deleted at the next send (07-06 recipient check). Unblock afterwards. | Status: blocked — not run |
| 15 | Android Chrome | With push on, uninstall and reinstall the app (or clear the site data) without turning push off, then publish a post as the admin. | The first push to the dead endpoint returns 404/410 and its `push_subscriptions` row is deleted; nothing reaches the device until the member turns push on again. | Status: blocked — not run |
| 16 | iPhone Home Screen app, Android Chrome, iPad | Look at the push host of each device's subscription (`push_subscriptions.endpoint` host, read as the migration role). | Each host is on the API's push-service allow-list (`PUSH_SERVICE_HOST_SUFFIXES`, [ASSUMED] in 07-06); an unlisted host would have shown a visible 400 `endpoint_invalid` at "Ativar". | Status: blocked — not run |
| 17 | iPhone Home Screen app and Android Chrome | Open the bell, Notificações, a support thread (member) and the staff inbox (staff account on a phone) at the phone's width. | The dot, the thread header, the staff inbox rows and the staff thread read correctly on a real phone (07-09, 07-10 D11). | Status: blocked — not run |

## Recording

For each row, replace `blocked — not run` with `passed` or `failed — <what happened>`, and add the
device model, the OS and browser versions, and the date. A failing row is a gap for
`/gsd-plan-phase --gaps`, not something to fix in place.
