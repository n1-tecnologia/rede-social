/**
 * Promoted to `@tria/core/ui` (04-04) so a MODULE package may render a private image without
 * importing from `apps/web` (MOD-02). Every Phase 3 call site keeps compiling through this line.
 */
export { MediaImage, type MediaImageProps } from '@tria/core/ui';
