'use client';

import type { ReactNode } from 'react';
import type { AttachmentDescriptor } from './AttachmentRow';

/**
 * INERT STUB — the RED half of this task's TDD cycle. The real renderer lands in the GREEN commit.
 */
export type PostMediaImage = {
  assetId: string;
  variantWidths: readonly number[];
  alt: string;
  label: string;
  width: number | null;
  height: number | null;
};

export type PostMediaLabels = {
  carousel: string;
  attachmentError: string;
};

export type PostMediaProps = {
  mediaKind: 'none' | 'gallery' | 'video';
  images: readonly PostMediaImage[];
  video?: ReactNode;
  attachments: readonly AttachmentDescriptor[];
  onDoubleTapLike?: () => void;
  labels: PostMediaLabels;
};

export function PostMedia(_props: PostMediaProps): ReactNode {
  return null;
}
