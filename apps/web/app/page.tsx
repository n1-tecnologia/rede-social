import { redirect } from 'next/navigation';

// `/` has no content of its own: authenticated users land on `/inicio` (D-07); proxy.ts sends
// unauthenticated requests to `/entrar` before this page runs.
export default function RootPage() {
  redirect('/inicio');
}
