import { ReelsStage } from '@rede-social/module-reels/ui';
import { Loader2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * `/reels` loading (UI-D-92, UI E03 loading): the black stage with one centred spinner. There is no
 * lane or rail skeleton, because nothing honest can be skeletonised over a video that has not
 * arrived. It is the SAME `ReelsStage` the route renders, so the swap to the first video happens on
 * an unchanged black ground under the unchanged dark BottomNav.
 */
export default async function ReelsLoading() {
  const t = await getTranslations('reels');
  return (
    <ReelsStage label={t('region')}>
      <div aria-busy className="absolute inset-0 grid place-items-center">
        <Loader2
          aria-hidden
          size={24}
          className="animate-spin text-white/70 motion-reduce:animate-none"
        />
      </div>
    </ReelsStage>
  );
}
