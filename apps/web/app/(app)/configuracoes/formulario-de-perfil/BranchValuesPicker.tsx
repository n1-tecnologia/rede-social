'use client';

import type { AdminQuestion } from '@rede-social/contracts/profile-form';

export interface BranchValuesPickerProps {
  /** The opener whose answers can open the branch (its type, options and "Outro"). */
  opener: AdminQuestion;
  /** The ticked tokens: option ids for a choice opener, `'true'` / `'false'` for yes/no. */
  values: string[];
  onChange: (values: string[]) => void;
  /** The line under the picker (`role="alert"`), wired with `aria-describedby` and `aria-invalid`. */
  error?: string;
}

/**
 * The answers that open a branch (12.2-16, D-640, UI-D-671). RED-stage stub: inert, replaced in the GREEN
 * commit by the value controls of the 12.1 condition editor.
 */
export function BranchValuesPicker(_props: BranchValuesPickerProps) {
  return null;
}
