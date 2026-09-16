import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Conditional class names with Tailwind conflict resolution (later utilities win). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
