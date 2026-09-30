# Phase 7: Notifications, Web Push & Chat - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-29
**Phase:** 07-notifications-web-push-chat
**Areas discussed:** Support chat shape, New-post notifications, Push opt-in & content, Unread & badges

The user picked the recommended option on every single-choice question. On "Other kinds" (multi-select), they chose all three.

---

## Support chat shape

| Question | Options presented | Selected |
|----------|-------------------|----------|
| Member chat entry | Straight into thread (rec.) / Ajuda hub first | Straight into thread |
| Resolve/close | No status, one ongoing thread (rec.) / Support can mark resolved | No status |
| Reply attribution | Team name + agent first name (rec.) / Team only / Agent name + avatar | Team + agent first name |
| Inbox roles | support_tenant + admin_tenant (rec.) / support_tenant only | Both roles |
| Staff entry | The inbox from the same slot (rec.) / Separate admin route | Same slot opens the inbox |
| Member info for staff | Name + avatar, link to profile (rec.) / Plus side panel | Name + avatar |
| Multi-agent | Shared thread, no assignment, shared unread (rec.) / Shared, per-agent unread | Shared, no assignment |
| Message body | Plain text, 2000 chars, links clickable (rec.) / Plain text, no links | Plain text 2000 + links |

## New-post notifications

| Question | Options presented | Selected |
|----------|-------------------|----------|
| Post scope | Every published post (rec.) / Feed posts only / Admin chooses per post | Every post |
| Burst | One per post (rec.) / Collapse within 1 h | One per post |
| Mark read | seen_at on open + read_at on tap (rec.) / Tap only / Open marks all | seen_at + read_at |
| Retention | Infinite scroll, 90-day prune (rec.) / Keep forever | 90-day prune |
| Other kinds (multi) | New reels / New stories / Event reactivated | All three |
| Support reply in bell | Chat badge + push only (rec.) / Bell row too | Badge + push only |
| Staff notifications | Staff get none of the broadcast kinds (rec.) / Everyone except author | Staff get none |
| Tap target | Post scrolled to the comment (rec.) / Just the post | Scrolled to the comment |

## Push opt-in & content

| Question | Options presented | Selected |
|----------|-------------------|----------|
| Opt-in spot | Settings row + soft-ask card (rec.) / Settings only / Also after first chat message | Settings + soft-ask card |
| iOS gate | Show existing InstallHint (rec.) / Hide switch outside standalone | InstallHint |
| Push kinds | All except likes (rec.) / Everything / Only personal | All except likes |
| Support push preview | Message preview (rec.) / Generic text | Message preview |
| Staff push | Every staff member with push on (rec.) / Inbox badge only | Yes |
| Foreground | Suppress when focused, except iOS (rec.) / Always show | Suppress |
| Post push | Tenant name + excerpt (rec.) / Generic | Tenant name + excerpt |
| Throttle | Collapse by tag (rec.) / Max N per hour | Collapse by tag |

## Unread & badges

| Question | Options presented | Selected |
|----------|-------------------|----------|
| Member badge | Dot (rec.) / Count of unread messages | Dot |
| Staff badge | Conversations awaiting staff (rec.) / Total unread messages | Awaiting count |
| App icon badge | Yes, bell unseen + chat (rec.) / No | Yes |
| Reconnect | Refetch on reconnect/visibility (rec.) / Rely on Realtime replay | Refetch |

## Claude's Discretion

- The roadmap's "Research needed" items: the RLS shape, `send` versus the trigger, quota, fan-out mechanics, `seq`, the service worker handlers and the channel tests.
- EVENT-07 scheduling edge cases.
- Expired stories and deleted targets.
- The channel adapter shape and the push subscription table.
- What staff see for a blocked member's thread.
- pt-BR copy.
- The D-33 sketch review for surfaces without a prototype.

## Deferred Ideas

- Resolve/close with triage chips.
- Assignment and per-agent unread.
- A member side panel for staff.
- A push rate limit.
- A contextual push ask after the first chat message.
- V2-NOTIF-01..03, already in V2.
