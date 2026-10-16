'use client';

import type { MaterialKind } from '@rede-social/module-courses/contracts';
import { Card, IconButton, SectionTitle, useToast } from '@rede-social/ui';
import {
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  type LucideIcon,
  Presentation,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { learnMaterialUrlAction } from '@/app/(app)/cursos/learn-actions';
import type { MemberMaterialView } from '@/lib/courses-member-view';
import { useLessonSession } from './LessonSession';

/**
 * "Materiais desta aula" (08.5-08, UI-D-432, COURSE-19): the open lesson's ready materials, with the
 * count "{n} arquivos" 12/400 tertiary on the right of the `SectionTitle`. A `Card p-0 divide-y` of
 * rows `flex min-h-14 items-center gap-3 px-3 py-2`: the 36px kind square (`FileText`,
 * `FileSpreadsheet`, `Presentation`, `Image`), the file name 14/700 `truncate`, "{kind} · {size}"
 * 12/400 tertiary, and the 44px `IconButton` `Download` 20 "Baixar {file}".
 *
 * A tap asks the member route for a ten-minute signed URL minted for THIS tap and opens it
 * `noopener,noreferrer`; the button is disabled while that call runs (E09 loading). A failure toasts
 * "Não foi possível abrir o material. Tente novamente."; a lock or removal answer is the session's
 * UI-D-433 reaction. The URL is never kept: it lives in this closure for one `window.open`.
 *
 * The host renders the section only when the lesson has at least one material (E09 empty).
 */
export interface MemberMaterialsProps {
  lessonId: string;
  materials: MemberMaterialView[];
  /** "1 arquivo" / "{n} arquivos". */
  countLabel: string;
}

const KIND_GLYPH: Record<MaterialKind, LucideIcon> = {
  pdf: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  image: ImageIcon,
  other: FileText,
};

export function MemberMaterials({ lessonId, materials, countLabel }: MemberMaterialsProps) {
  const t = useTranslations('courses.member.player');
  const toast = useToast();
  const session = useLessonSession();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function open(materialId: string) {
    setPendingId(materialId);
    try {
      const result = await learnMaterialUrlAction(lessonId, materialId);
      if (result.ok) {
        window.open(result.url, '_blank', 'noopener,noreferrer');
        return;
      }
      if (session.refuse(result.code)) return;
      toast.show({ tone: 'error', message: t('errors.material') });
    } catch {
      toast.show({ tone: 'error', message: t('errors.material') });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section
      aria-labelledby="lesson-materials"
      data-testid="lesson-materials"
      className="flex flex-col gap-3 px-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle id="lesson-materials">{t('materials')}</SectionTitle>
        <span
          data-testid="lesson-materials-count"
          className="shrink-0 text-xs font-normal text-text-tertiary tabular-nums"
        >
          {countLabel}
        </span>
      </div>
      <Card className="p-0">
        <ul aria-labelledby="lesson-materials" className="flex flex-col divide-y divide-divider">
          {materials.map((material) => {
            const Glyph = KIND_GLYPH[material.kind];
            return (
              <li
                key={material.id}
                data-testid="lesson-material-row"
                className="flex min-h-14 items-center gap-3 px-3 py-2"
              >
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-tertiary text-text-secondary"
                >
                  <Glyph size={18} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    data-testid="lesson-material-name"
                    className="truncate text-sm font-bold text-text"
                  >
                    {material.name}
                  </span>
                  <span className="mt-0.5 text-xs font-normal text-text-tertiary tabular-nums">
                    {material.meta}
                  </span>
                </span>
                <IconButton
                  icon={Download}
                  size={20}
                  label={material.downloadLabel}
                  data-testid="lesson-material-download"
                  disabled={pendingId === material.id}
                  aria-busy={pendingId === material.id}
                  onClick={() => void open(material.id)}
                  className="shrink-0 text-text-secondary"
                />
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
