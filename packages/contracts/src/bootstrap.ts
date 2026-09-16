import { z } from 'zod';
import { tenantBrandingSchema } from './branding';
import { TENANT_ROLES, TOGGLEABLE_MODULES } from './modules';

/** `GET /v1/me/bootstrap` (ARCHITECTURE §Pattern 3). `modules`/`permissions` are filled by plan 01-06. */
export const bootstrapSchema = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    name: z.string(),
  }),
  membership: z.object({
    tenantId: z.uuid(),
    role: z.enum(TENANT_ROLES),
    status: z.enum(['active', 'blocked', 'invited']),
    profile: z.object({
      displayName: z.string(),
      avatarUrl: z.string().nullable(),
      bio: z.string().nullable(),
    }),
  }),
  tenant: z.object({
    id: z.uuid(),
    slug: z.string(),
    displayName: z.string(),
    // D-25 structured brand; the API answers it RESOLVED (`resolveBranding`), so every key is present.
    branding: tenantBrandingSchema,
  }),
  modules: z.array(
    z.object({
      key: z.enum(TOGGLEABLE_MODULES),
      nav: z
        .object({
          label: z.string(),
          icon: z.string(),
          href: z.string(),
          order: z.number(),
          // D-40: absent = 'tab' (BottomNav / rail); 'topbar' = TopBar slot / rail bottom-group row.
          placement: z.enum(['tab', 'topbar']).optional(),
          // D-40: a 'topbar' slot's count badge reads this `counters` key.
          badge: z.enum(['unreadNotifications', 'unreadConversations']).optional(),
        })
        .optional(),
      // D-42: home-slot declarations; the web composition point supplies the renderer per key/index.
      home: z.array(z.object({ order: z.number() })).optional(),
      settings: z.record(z.string(), z.unknown()),
    }),
  ),
  permissions: z.array(z.string()),
  counters: z.object({
    unreadNotifications: z.number(),
    unreadConversations: z.number(),
  }),
});
export type Bootstrap = z.infer<typeof bootstrapSchema>;
