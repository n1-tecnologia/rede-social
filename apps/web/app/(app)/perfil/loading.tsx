import { ProfileHeroSkeleton } from '@/components/profile/ProfileHero';

/**
 * `/perfil` loading (UI-SPEC E1/loading), rebuilt for the 2026-10-12 layout: the hero in its own
 * geometry (the brand band needs no data, so it shows at once). The shape of the screen, never a
 * spinner. It covers only the page's own reads (the bootstrap and the profile); nothing more is
 * drawn here because what follows depends on data this file cannot know: the "Complete seu perfil"
 * warning shows only for an incomplete profile, and the Eventos and Comunidades sections only with
 * their modules on (they stream with their own skeletons).
 */
export default function ProfileLoading() {
  return (
    <div className="flex flex-col gap-8 pb-6" aria-busy>
      <ProfileHeroSkeleton />
    </div>
  );
}
