import { cn } from '@rede-social/ui';
import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * The member's visibility notice (10-12: UI-D-704, UI-D-705, D-716): "Todos os membros verão este story
 * na comunidade." One sentence, two tones, because it is drawn over two grounds:
 *
 *  - `frame`: on the publish screen's BLACK frame, right under the destination row once a highlight is
 *    chosen. It replaces the audience line ("Quem segue você vê este story…") and is STRONGER than it
 *    (12/700 `text-white` against 12/400 `text-white/70`), because the story stops being
 *    followers-only the moment it is saved into a community highlight;
 *  - `sheet`: at the top of the destination sheet and of the highlight checklist, above the groups,
 *    12/700 `text-text`.
 *
 * `Users` 14 is decorative. The sentence is a fixed catalog string with no name in it, so it wraps and
 * never overflows; the module sheets only receive this node, they ship no words.
 */
export function StoryVisibilityNotice({ tone }: { tone: 'frame' | 'sheet' }) {
  const t = useTranslations('stories');
  return (
    <p
      data-testid="story-visibility-notice"
      className={cn(
        'flex items-start gap-1 text-xs font-bold',
        tone === 'frame' ? 'text-white' : 'pb-2 text-text',
      )}
    >
      <Users aria-hidden size={14} className="mt-0.5 shrink-0" />
      {t('publish.member.visibility')}
    </p>
  );
}
