'use client';

import type { ReactNode } from 'react';

/**
 * INERT STUB — the RED half of this task's TDD cycle. The real row lands in the GREEN commit.
 */
export type AttachmentDescriptor = {
  assetId: string;
  filename: string;
  typeLabel: string;
  sizeLabel: string | null;
  downloadLabel: string;
};

export type AttachmentRowProps = {
  attachment: AttachmentDescriptor;
  onError: () => void;
};

export function AttachmentRow(_props: AttachmentRowProps): ReactNode {
  return null;
}
