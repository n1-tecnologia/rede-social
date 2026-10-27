'use client';

// RED stub (09.4-14): replaced by the real component in the GREEN commit.
export type ProjectTokenValues = { token: string; expiresAt: string };
export type ProjectTokenErrors = { token?: string; expiresAt?: string };

export function ProjectTokenFields(_props: {
  values: ProjectTokenValues;
  onChange: (next: ProjectTokenValues) => void;
  errors?: ProjectTokenErrors;
  disabled?: boolean;
  today: string;
}) {
  return null;
}
