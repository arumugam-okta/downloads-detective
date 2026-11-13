import { redirect } from 'next/navigation';
import { getSession, ROLE_HOME } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const s = await getSession();
  redirect(ROLE_HOME[s.role]);
}
