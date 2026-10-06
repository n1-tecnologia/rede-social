# @rede-social/module-events

The tenant's events (EVENT-01..07): a timezone-aware start and end, in person or online, with the
meeting URL and the check-in code kept in the admin-only `event_secrets` table. Members see the
upcoming and past lists, answer (RSVP), check in at the venue with the code and enter online events;
admins create, edit, cancel and reactivate events and read attendance. Reminders fire 24 h and 1 h
before the start through a deferred job. Its schema references only kernel tables (`tenants`,
`users`, `media_assets`), which is why it is the module the reuse fixture mounts.

## Contracts

The package's `exports` map is the whole public surface; nothing else may be imported.

| Subpath | What it holds |
|---|---|
| `./module` | `eventsModule`, the manifest |
| `./contracts` | Zod schemas and constants shared with the web app |
| `./server` | `eventsRoutes`, the service functions, `eventReminderJob`, `eventsNotificationSources` |
| `./ui` | `EventPoster`, `EventTicket`, `EventHero`, `EventInfoGrid`, `EventCover`, `NextEventCard`, `AttendeeRow`, `CheckinCodeCard` |
| `./db` | Drizzle tables `events`, `eventSecrets`, `eventAttendances`, `eventCheckinAttempts` with their RLS policies |

Main contract names (`./contracts`): `eventInputSchema`, `eventQuerySchema`, `eventSummarySchema`,
`eventDetailSchema`, `eventPageSchema`, `nextEventSchema`, `eventEditSchema`,
`eventStatusUpdateSchema`, `rsvpSchema`, `rsvpResultSchema`, `checkinSchema`, `checkinResultSchema`,
`enterResultSchema`, `attendanceQuerySchema`, `attendancePageSchema`, `attendanceSummarySchema`,
`checkinCodeSchema`, `eventReminderPayloadSchema`, the permission names `EVENT_PERMISSIONS`
(`events.event.manage`, `events.attendance.read`, `events.attendance.respond`), the refusal
vocabulary `EVENT_ISSUES`, `EVENTS_QUEUES` and `EVENTS_NOTIFICATION_KINDS`.

Main server names (`./server`): `eventsRoutes`, `listEvents`, `getEvent`, `getNextEvent`,
`createEvent`, `updateEvent`, `setEventStatus`, `rsvpEvent`, `checkInEvent`, `enterEvent`,
`listAttendance`, `getAttendanceSummary`, `regenerateCheckinCode`, `armEventReminders`,
`eventReminderJob`, `eventsNotificationSources`, `eventsSystemCtx`.

## Events emitted

Payloads carry ids, statuses and instants only, never a title, URL or code.

- `event.published`: `tenantId`, `eventId`, `actorUserId`, `format`, `startsAt`, `endsAt`
- `event.updated`: `tenantId`, `eventId`, `actorUserId`, `format`, `startsAt`, `endsAt`, `timesChanged`
- `event.cancelled`: `tenantId`, `eventId`, `actorUserId`, `startsAt`, `endsAt`
- `event.reactivated`: `tenantId`, `eventId`, `actorUserId`, `startsAt`, `endsAt`
- `event.rsvp`: `tenantId`, `eventId`, `userId`, `status`, `previousStatus`, `startsAt`
- `event.checked_in`: `tenantId`, `eventId`, `userId`, `walkIn`, `via`, `startsAt` (first check-in only)
- `event.reminder_due`: `tenantId`, `eventId`, `window`, `startsAt` (emitted by the reminder job)

## Events consumed

- Manifest subscriptions (log the shape only): `event.published`, `event.rsvp`, `event.updated`,
  `event.cancelled`, `event.reactivated`, `event.checked_in`, `event.reminder_due`.
- Notification sources (handed to the notifications module through the kernel seam):
  `event.published`, `event.reactivated`, `event.reminder_due`. Edits and cancellations are silent.
- Notification retractions: none.

## Flag key

`events` in `tenant_modules`. No `requires`.

## Kernel dependencies

- `@rede-social/core/db/rls`
- `@rede-social/core/db/schema`
- `@rede-social/core/db/tenant-tx`
- `@rede-social/core/server/auth/context`
- `@rede-social/core/server/auth/require-auth`
- `@rede-social/core/server/events/bus`
- `@rede-social/core/server/http/api-error`
- `@rede-social/core/server/jobs/boss`
- `@rede-social/core/server/logging`
- `@rede-social/core/server/media/service`
- `@rede-social/core/server/modules/manifest`
- `@rede-social/core/server/modules/require-module`
- `@rede-social/core/server/notifications/source`
- `@rede-social/core/server/paging`
- `@rede-social/core/server/rbac/permissions`
- `@rede-social/core/ui`

## Navigation

- Tab "Eventos": placement `tab`, href `/eventos`, icon `calendar-days`, order 40.
- Home slot at order 7: the Início "Próximo evento" card (`NextEventCard`), rendered by the web
  registry.

## Jobs

- `events.reminder` (`eventReminderJob`): one deferred job per event and window (24 h, 1 h), armed
  inside the module's own write transactions and re-checked when it fires.
- Sweep functions: none.

## Reuse

The worked example lives in `packages/reuse-fixture`, which mounts this module on an app that
provides only the kernel contracts. A host app must provide: a request id and a per-request logger,
`flushEventsAfterHandler`, an `onError` rendering `errorEnvelope`, `setPermissionResolver` with the
kernel grants plus `defaultRolePermissions` (`admin_tenant`: manage, attendance read, respond;
`support_tenant` and `member`: respond), the manifest's `events` subscribed on the bus, its job
names registered with `registerJobQueues`, and `.route('/v1/events', eventsRoutes)`. The routes carry
their own `requireAuth`, `requireModule('events')` and `requirePermission` chain. Reminders reach
members only when the notifications module provides the sink.
