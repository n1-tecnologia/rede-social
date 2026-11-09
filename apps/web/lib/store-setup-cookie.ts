import { cookies } from 'next/headers';
import {
  parseAssignments,
  parseStoreSetup,
  STORE_ASSIGN_COOKIE,
  STORE_SETUP_COOKIE,
  type StoreAssignments,
  type StoreSetup,
} from '@/lib/store-setup';

/** The store's setup on THIS device (`lib/store-setup.ts`), read on the server. */
export async function readStoreSetup(): Promise<{
  setup: StoreSetup;
  assignments: StoreAssignments;
}> {
  const jar = await cookies();
  return {
    setup: parseStoreSetup(jar.get(STORE_SETUP_COOKIE)?.value),
    assignments: parseAssignments(jar.get(STORE_ASSIGN_COOKIE)?.value),
  };
}
