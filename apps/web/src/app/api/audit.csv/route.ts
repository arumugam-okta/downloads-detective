import { NextRequest } from 'next/server';
import { getSession, getStore, resolveRange } from '@/lib/session';

const esc = (v: unknown) => {
  const s = String(v ?? '');
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s.viewer.roles.includes('compliance')) return new Response('Forbidden', { status: 403 });
  const q = req.nextUrl.searchParams;
  const range = resolveRange(s.world.now, q.get('from') ?? undefined, q.get('to') ?? undefined);
  const { events } = await (await getStore()).listAudit({
    from: range.from.toISOString(), to: range.to.toISOString(), ...(q.get('actor') ? { actorLabel: q.get('actor')! } : {}), ...(q.get('action') ? { action: q.get('action')! } : {}), limit: 50_000, offset: 0,
  });
  const rows = [['at_utc', 'actor', 'action', 'detail', 'item_id', 'import_id'], ...events.map((e) => [e.at, e.actorLabel, e.action, e.detail ?? '', e.itemId ?? '', e.importId ?? ''])];
  return new Response(rows.map((r) => r.map(esc).join(',')).join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="audit-log.csv"', 'cache-control': 'no-store' } });
}
