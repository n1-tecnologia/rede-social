'use client';

import type { AdminQuestion, AdminStep } from '@rede-social/contracts/profile-form';
import { Button, EmptyState } from '@rede-social/ui';
import { ClipboardList, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import type { EditorMode } from './editor-state';
import { PreviewSheet } from './PreviewSheet';
import { QuestionEditorSheet } from './QuestionEditorSheet';
import { QuestionList } from './QuestionList';

export interface QuestionBuilderProps {
  /** The ACTIVE questions in the order members see them. */
  questions: AdminQuestion[];
  /** The tenant's steps in order. */
  steps?: AdminStep[];
  /** The most active questions a tenant may have. */
  limit: number;
  /** The tenant's display name: the `{tenant}` of the editor's LGPD notice. */
  tenantName: string;
}

interface Opening {
  /** A new key per opening: the sheet remounts, so every opening starts from its source. */
  id: number;
  mode: EditorMode;
  question: AdminQuestion | null;
}

/**
 * The Perguntas tab's interactive body (12-16): the list, or the empty state, and the ONE editor sheet
 * they open. The list's rows open the sheet in edit mode, "Adicionar pergunta" (the list's actions row, or
 * the empty state's call to action) in create mode, and the locked states' "Criar nova pergunta e arquivar
 * esta" in replace mode, and "Ver como o membro vê" opens the preview sheet (12-17) over the live active
 * questions. The page reads on the server; this holds only which
 * opening is showing, and the page refreshes after every write.
 */
export function QuestionBuilder({ questions, steps, limit, tenantName }: QuestionBuilderProps) {
  const t = useTranslations('profileForm.admin');
  // `opening` is kept after a close so the sheet's exit animation can play; `open` is what it follows.
  const [opening, setOpening] = useState<Opening | null>(null);
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const openCreate = useCallback(() => {
    setOpening((current) => ({ id: (current?.id ?? 0) + 1, mode: 'create', question: null }));
    setOpen(true);
  }, []);
  const openEdit = useCallback((question: AdminQuestion) => {
    setOpening((current) => ({ id: (current?.id ?? 0) + 1, mode: 'edit', question }));
    setOpen(true);
  }, []);
  const openReplace = useCallback((question: AdminQuestion) => {
    setOpening((current) => ({ id: (current?.id ?? 0) + 1, mode: 'replace', question }));
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const openPreview = useCallback(() => setPreviewOpen(true), []);
  const closePreview = useCallback(() => setPreviewOpen(false), []);

  return (
    <>
      {questions.length > 0 ? (
        <QuestionList
          questions={questions}
          limit={limit}
          onOpen={openEdit}
          onAdd={openCreate}
          onPreview={openPreview}
        />
      ) : (
        <EmptyState
          variant="card"
          icon={ClipboardList}
          title={t('empty.title')}
          body={t('empty.body')}
          action={
            <Button size="md" onClick={openCreate}>
              <Plus aria-hidden size={18} />
              {t('actions.add')}
            </Button>
          }
        />
      )}
      {opening ? (
        <QuestionEditorSheet
          key={opening.id}
          open={open}
          mode={opening.mode}
          question={opening.question}
          tenantName={tenantName}
          limit={limit}
          onClose={close}
          onReplace={openReplace}
        />
      ) : null}
      <PreviewSheet open={previewOpen} questions={questions} steps={steps} onClose={closePreview} />
    </>
  );
}
