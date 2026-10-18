/**
 * RED stub (08.7-05 Task 1): the row views of the owner panel's paged lists. Inert until GREEN.
 */
export interface MemberCardLine {
  label: string;
  value: string;
  comingSoon?: boolean;
}

export interface MemberRowView {
  type: 'member';
  id: string;
  href: string;
  name: string;
  initials: string;
  lead?: string;
  lines: MemberCardLine[];
}

export interface ItemRowView {
  type: 'item';
  id: string;
  title: string;
  lines: string[];
  aside?: string;
}

export type OwnerListRowView = MemberRowView | ItemRowView;

export type OwnerListPage = { rows: OwnerListRowView[]; nextCursor: string | null };
