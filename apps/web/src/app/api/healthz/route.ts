import { getStore } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Readiness + diagnosis. No auth, and no secrets: it reports only whether each dependency answers.
 * "db" shows the real reason (not configured, schema not exposed, missing tables) so a first deploy explains itself.
 */
export async function GET() {
  let db: string;
  try {
    const store = await getStore();
    await store.getPolicy(); // reads dd_policy_settings; fails clearly if the tables are not reachable
    db = 'ok';
  } catch (e) {
    db = `error: ${(e as Error).message}`.slice(0, 300);
  }
  const slack = process.env.SLACK_BOT_TOKEN ? (process.env.SLACK_APP_TOKEN ? 'live+buttons' : 'live, no buttons') : 'dev (logged only)';
  return Response.json({ ok: true, db, slack, mode: process.env.SERVICE_URL ? 'two-service' : 'mono' }, { status: 200 });
}
