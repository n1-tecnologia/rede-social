/**
 * Domain events (MOD-03 shape, plan 01-07).
 *
 * `EventMap` is the single extension point: a module declares its own payloads with
 * `declare module '@tria/contracts' { interface EventMap { 'x.y': Payload } }` from its
 * `contracts` entry point. The kernel therefore never learns any module's event names at
 * authoring time, yet `emit`/`subscribe` stay fully typed at every call site (MOD-02).
 *
 * Empty on purpose here: an empty `EventMap` makes `DomainEventName` `never`, which is exactly
 * right for a build that contains no module at all.
 */
// biome-ignore lint/suspicious/noEmptyInterface: extension point — modules declaration-merge into it
export interface EventMap {}

/** Every event name any loaded module has declared. */
export type DomainEventName = keyof EventMap;

/**
 * One emitted event, collected on `RequestContext.events` and dispatched AFTER the transaction
 * that produced it commits. `tenantId` travels with the record so a subscriber never has to read
 * it back from ambient state.
 */
export type DomainEventRecord = {
  name: DomainEventName;
  payload: unknown;
  tenantId: string;
  occurredAt: string;
};
