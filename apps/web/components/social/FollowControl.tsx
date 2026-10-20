'use client';

/** RED stub (09-10 Task 1): replaced by the GREEN commit. */
export interface FollowControlProps {
  membershipId: string;
  name: string;
  size: 'md' | 'sm';
  initialFollowing: boolean | null;
  fullWidth?: boolean;
  className?: string;
  onChange?: (followerCount: number) => void;
}

export function FollowControl(_props: FollowControlProps) {
  return null;
}
