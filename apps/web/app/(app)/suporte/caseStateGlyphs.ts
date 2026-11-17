import { CircleCheck, CircleDot, Lock, UserCheck } from 'lucide-react';
import type { CaseStateGlyph } from '@/lib/chat-view';

/**
 * The lucide glyph of each case state pill (UI-D-817): the view model sends the glyph NAME and the screen maps
 * it here (MOD-02). Shared by the staff bar and the details sheet; it imports nothing server-side, so a sheet
 * that draws a pill never pulls the server actions in.
 */
export const CASE_STATE_GLYPHS: Record<CaseStateGlyph, typeof CircleDot> = {
  CircleDot,
  UserCheck,
  CircleCheck,
  Lock,
};
