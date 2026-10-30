'use client';

import type { AdminQuestion } from '@rede-social/contracts/profile-form';
import { Button, EmptyState } from '@rede-social/ui';
import { ClipboardList, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import type { EditorMode } from './editor-state';
import { QuestionEditorSheet } from './QuestionEditorSheet';
import { QuestionList } from './QuestionList';

export interface QuestionBuilderProps {
  /** The ACTIVE questions in the order members see them. */
  questions: AdminQuestion[];
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
 * both open. The list's rows open the sheet in edit mode and "Adicionar pergunta" (the list's actions row,
 * or the empty state's call to action) in create mode. The page reads on the server; this holds only which
 * opening is showing, and the page refreshes after every write.
 */
export function QuestionBuilder({ questions, limit, tenantName }: QuestionBuilderProps) {
  const t = useTranslations('profileForm.admin');
  // `opening` is kept after a close so the sheet's exit animation can play; `open` is what it follows.
  const [opening, setOpening] = useState<Opening | null>(null);
  const [open, setOpen] = useState(false);

  const openCreate = useCallback(() => {
    setOpening((current) => ({ id: (current?.id ?? 0) + 1, mode: 'create', question: null }));
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      {questions.length > 0 ? (
        <QuestionList questions={questions} limit={limit} onAdd={openCreate} />
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
          tenantName={tenantName}
          limit={limit}
          onClose={close}
        />
      ) : null}
    </>
  );
}
