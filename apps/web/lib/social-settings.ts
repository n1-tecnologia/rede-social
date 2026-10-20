import {
  SOCIAL_MODULE_KEY,
  SOCIAL_SETTINGS_DEFAULTS,
  type SocialSettings,
  socialSettingsSchema,
} from '@rede-social/module-social/contracts';

/**
 * The member composer's media limits (D-474, SOCIAL-05), read off the bootstrap the page already
 * holds. There is no fetch and no second source: the blob is `tenant_modules['social'].settings`,
 * parsed by the SAME tolerant `socialSettingsSchema` the API's registry uses, so a missing entry, an
 * empty blob or a stored value that no longer parses all land on the defaults and the function never
 * throws on a request path.
 *
 * **This is the browser copy of limits the API enforces** - UX, never authority. The upload broker
 * re-judges size at start and complete, the ready job re-judges duration, and the create route
 * re-judges the shape of the post with the `member` codes, so a stale tab or a hand-edited request
 * is refused there whatever this helper said.
 */
export function socialMediaLimits(bootstrap: {
  modules: ReadonlyArray<{ key: string; settings: Record<string, unknown> }>;
}): SocialSettings['media'] {
  const entry = bootstrap.modules.find((module) => module.key === SOCIAL_MODULE_KEY);
  const parsed = socialSettingsSchema.safeParse(entry?.settings ?? {});
  return parsed.success ? parsed.data.media : SOCIAL_SETTINGS_DEFAULTS.media;
}
