import type { DomainEventName, EventMap } from '@rede-social/contracts';
import type { Tx } from '../../db/tenant-tx';

/**
 * The notification seam (07-01, RESEARCH Pattern 1) — `setPermissionResolver` applied to the bell.
 *
 * A domain event's payload is ids only, so SOMEONE must read the excerpt, the community name or the
 * `Vou` list to build a notification, and only the PRODUCER may read its own tables. The kernel
 * therefore declares the SHAPE here, a producer module (feed, stories, events, chat) declares its
 * `notificationSources` in its manifest, the app registry registers them on this map, and the
 * notifications module consumes them through the sink (`./sink.ts`). The notifications module never
 * imports a producer and a producer never imports the notifications module (MOD-02: `turbo
 * boundaries` forbids module to module), and removing either removes only its own half (MOD-03).
 *
 * Every `resolve` runs IN THE WORKER, inside ONE tenant-lane transaction of the event's tenant, and
 * returns intents: data, never sentences (CONTEXT: text is rendered from `kind` + facts by the web).
 */

/** A delivery channel (NOTIF-04). A V2 adapter (e-mail, WhatsApp) is a union member plus a file. */
export type NotificationChannelKey = 'in_app' | 'push';

/**
 * Who receives an intent. `members` is every LIVE `member`-role membership of the tenant (D-229:
 * staff never get the broadcast kinds); `users` is an explicit list, still filtered by the same live
 * predicate (active, not blocked, not soft-deleted) inside the database.
 */
export type NotificationAudience = { type: 'members' } | { type: 'users'; userIds: string[] };

/** Push rendering hints; the push adapter (07-06) renders and sends them. Never stored in a row. */
export interface NotificationPushHint {
  /** `tenant` = the tenant's display name; `team` = "Equipe {tenant}" (support replies, D-235). */
  title: 'tenant' | 'team';
  /** The rendered pt-BR body (UI-SPEC §Push banner copy), at most ~100 characters. */
  body: string;
  /** Where a tap lands (D-232). A path, never an absolute URL. */
  url: string;
  /** One `tag` per broadcast kind so the newest banner replaces the previous one (D-236). */
  tag: string;
  topic: string;
  ttlSeconds: number;
  urgency: 'normal' | 'high';
  renotify: boolean;
}

/** One notification to deliver, as a producer describes it. Facts are data, never a sentence. */
export interface NotificationIntent {
  /** `<module>.<kind>`, e.g. `feed.post`. The web registry renders the sentence from it. */
  kind: string;
  audience: NotificationAudience;
  /** Always the actor/author (D-229: an author never notifies themselves). */
  excludeUserIds: string[];
  /** Natural idempotency key (RESEARCH Pattern 6): `unique (tenant_id, user_id, dedupe_key)`. */
  dedupeKey: string;
  /** Routing and retraction target, e.g. `{ type: 'post', id }`. */
  subject: { type: string; id: string };
  /** A narrower target inside the subject (the comment inside the post), or null. */
  object: { type: string; id: string } | null;
  actorUserId: string | null;
  /** What the sentence is rendered from: excerpts (at most 80 graphemes), names, ids, instants. */
  facts: Record<string, string | number | boolean | null>;
  channels: NotificationChannelKey[];
  push: NotificationPushHint | null;
}

/** A producer's declaration: for `event`, turn the payload into zero or more intents. */
export interface NotificationSource<K extends DomainEventName = DomainEventName> {
  event: K;
  /**
   * Reads the producer's OWN tables in `tx` (the worker's tenant lane of the payload's tenant).
   * `meta.sinkAt` is the instant the bus delivered the event, stamped once and reused by a retried
   * job, so two deliveries of one logical event can be told apart (07-05's reactivations).
   */
  resolve(tx: Tx, payload: EventMap[K], meta: { sinkAt: string }): Promise<NotificationIntent[]>;
}

/** A deleted target's rows to retract (07-04 consumes it): match on the subject or the object. */
export interface NotificationRetraction<K extends DomainEventName = DomainEventName> {
  event: K;
  match(payload: EventMap[K]): { on: 'subject' | 'object'; type: string; id: string };
}

// Payload-erased storage: the kernel cannot (and must not) know any module's payload shape. The
// default type parameter plus METHOD syntax (`resolve(…)`, `match(…)`, which TypeScript checks
// bivariantly) is what lets a `NotificationSource<'post.published'>` sit in this list without an
// `any`: the `EventSubscription` shape in `../modules/manifest.ts` relies on the same rule.
type AnySource = NotificationSource;
type AnyRetraction = NotificationRetraction;

const sources = new Map<DomainEventName, Set<AnySource>>();
const retractions = new Map<DomainEventName, Set<AnyRetraction>>();

/** Called by the app registry at import time. Registering the same object twice is a no-op. */
export function registerNotificationSource<K extends DomainEventName>(
  source: NotificationSource<K>,
): void {
  const set = sources.get(source.event) ?? new Set<AnySource>();
  set.add(source as AnySource);
  sources.set(source.event, set);
}

/** Called by the app registry at import time. Registering the same object twice is a no-op. */
export function registerNotificationRetraction<K extends DomainEventName>(
  retraction: NotificationRetraction<K>,
): void {
  const set = retractions.get(retraction.event) ?? new Set<AnyRetraction>();
  set.add(retraction as AnyRetraction);
  retractions.set(retraction.event, set);
}

/** Every source registered for `event`, in registration order. */
export function sourcesFor<K extends DomainEventName>(event: K): NotificationSource<K>[] {
  return [...(sources.get(event) ?? [])] as NotificationSource<K>[];
}

/** Every retraction registered for `event`, in registration order. */
export function retractionsFor<K extends DomainEventName>(event: K): NotificationRetraction<K>[] {
  return [...(retractions.get(event) ?? [])] as NotificationRetraction<K>[];
}

/** The distinct event names any source or retraction listens to: one bus subscription each. */
export function notificationEvents(): DomainEventName[] {
  return [...new Set<DomainEventName>([...sources.keys(), ...retractions.keys()])];
}
