import { z } from 'zod';

/**
 * The module's published contract surface (`@tria/module-example/contracts`). Both the API and the
 * web app import from here — the same Zod schema validates the request body in Hono and the form in
 * the server action, so there is exactly one definition of what an example item is (MOD-01).
 */

export const exampleItemSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  title: z.string().min(1).max(120),
  createdByUserId: z.uuid(),
  createdAt: z.string(),
  processedAt: z.string().nullable(),
});
export type ExampleItem = z.infer<typeof exampleItemSchema>;

export const exampleItemsSchema = z.object({ items: z.array(exampleItemSchema) });
export type ExampleItems = z.infer<typeof exampleItemsSchema>;

export const createExampleItemSchema = z.object({
  title: z.string().trim().min(1).max(120),
});
export type CreateExampleItem = z.infer<typeof createExampleItemSchema>;

/** Payload of the module's single domain event, published for any consumer (MOD-03). */
export interface ExampleItemCreated {
  tenantId: string;
  itemId: string;
  userId: string;
}

/** The pg-boss queue this module owns. One name, exported so the registry and tests never retype it. */
export const EXAMPLE_PROCESS_QUEUE = 'example.process';

/** Payload of the `example.process` job. `tenantId` is data, not authority: the handler re-enters the tenant lane with it and RLS decides (T-07-03). */
export interface ExampleProcessJob {
  tenantId: string;
  itemId: string;
}

/**
 * MOD-02 in one block: the module teaches the KERNEL's `EventMap` about its own event instead of
 * the kernel knowing modules exist. Anything that imports this file gets `emit`/`subscribe` typed
 * for `example.item.created`.
 */
declare module '@tria/contracts' {
  interface EventMap {
    'example.item.created': ExampleItemCreated;
  }
}
