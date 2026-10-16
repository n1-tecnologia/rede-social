import { buttonClasses, cn } from '@rede-social/ui';
import { Eye } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * The admin preview banner (08.5-07, UI-D-437, D-422, COURSE-25): what an `admin_tenant` sees under
 * the `PageHeader` of every member page opened with `?ver=aluno` (course page here; player and lock
 * pages in plan 08). It says the two facts the preview changes — this is the member's view, and no
 * progress is recorded — and offers the way back to the edition (`/cursos/{courseId}`, the admin
 * course page).
 *
 * `mx-4 mt-3 flex items-start gap-3 rounded-xl bg-bg-tertiary px-3 py-3`: `Eye` 20 secondary, the
 * title 14/700, the body 12/400 secondary, and the trailing `ghost sm` LINK (a route). The host
 * renders it only when `isPreview` holds (role `admin_tenant` AND `?ver=aluno`); a member's or a
 * `support_tenant`'s `?ver=` never draws it (T-08.5-27). Server-rendered, no state.
 *
 * 08.6-11 (UI-D-459): the member AREA page (`/cursos?ver=aluno`, `MemberCatalogue`) renders it too,
 * between the area row and the body, with `backHref="/cursos"` (the hub) and its own margins
 * (`className`); the shipped copy is unchanged.
 */
export type PreviewBannerProps =
  | {
      courseId: string;
      /** Where "Voltar para a edição" leads; default `/cursos/{courseId}`. */
      backHref?: string;
      className?: string;
    }
  | { courseId?: undefined; backHref: string; className?: string };

/** The `ghost sm` look from `buttonClasses`, with the 44px hit area (UI-D-443). */
const GHOST_SM_LINK = buttonClasses({
  variant: 'ghost',
  size: 'sm',
  hitArea: true,
  className: 'shrink-0 px-3',
});

export async function PreviewBanner({ courseId, backHref, className }: PreviewBannerProps) {
  const t = await getTranslations('courses.member.preview');
  const back = backHref ?? `/cursos/${encodeURIComponent(courseId ?? '')}`;
  return (
    <div
      data-testid="preview-banner"
      className={cn(
        'mx-4 mt-3 flex items-start gap-3 rounded-xl bg-bg-tertiary px-3 py-3',
        className,
      )}
    >
      <Eye aria-hidden size={20} className="mt-px shrink-0 text-text-secondary" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-bold text-text">{t('title')}</p>
        <p className="text-xs font-normal text-text-secondary">{t('body')}</p>
      </div>
      <a href={back} data-testid="preview-banner-back" className={GHOST_SM_LINK}>
        {t('back')}
      </a>
    </div>
  );
}
