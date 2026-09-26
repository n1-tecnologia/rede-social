import type { ReactNode } from 'react';

/** RED STUB (05.3-05 Task 1) — inert; replaced in full by the GREEN commit. */
export interface ReelsStageProps {
  label: string;
  children: ReactNode;
}

export function ReelsStage({ children }: ReelsStageProps) {
  return <div>{children}</div>;
}
