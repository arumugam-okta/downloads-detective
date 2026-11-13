import { redirect } from 'next/navigation';
import { getSession, NoAccessError, ROLE_HOME } from '@/lib/session';
import { NoAccess } from '@/components/dd/no-access';

export const dynamic = 'force-dynamic';

/**
 * The platform's readiness probe requests "/" with no identity and needs a 2xx. A signed-out request must therefore
 * render a normal page, not throw. Signed-in users are sent to the home for their role.
 */
export default async function Home() {
  let home: string;
  try {
    home = ROLE_HOME[(await getSession()).role];
  } catch (e) {
    if (e instanceof NoAccessError) return <NoAccess message={e.message} />;
    throw e;
  }
  redirect(home);
}
