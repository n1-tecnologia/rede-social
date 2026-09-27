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
    // Phase 6 (locked): the IANA zone every date/time string is formatted in (`tenants.timezone`,
    // `America/Sao_Paulo` by default). The device's zone never enters. The API must deploy before the
    // web, because the web now requires this key.
    timezone: z.string(),
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
          // UI-D-81: the media chrome (dark floating BottomNav, no mobile TopBar) while this tab is
          // active. It MUST be declared here: this plain `z.object` STRIPS unknown keys on parse, so
          // omitting it would silently drop the field between the API and the shell.
          chrome: z.enum(['media']).optional(),
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
