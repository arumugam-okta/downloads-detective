import { NextRequest } from 'next/server';
import { getSession, resolveScope } from '@/lib/session';
import { toViews } from '@/lib/metrics';

const esc = (v: unknown) => {
  const s = String(v ?? '');
  // Neutralise spreadsheet formulas in user-controlled text.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function GET(req: NextRequest) {
  const s = await getSession();
  if (s.role === 'engineer') return new Response('Forbidden', { status: 403 });
  const scope = resolveScope(s, req.nextUrl.searchParams.get('scope') ?? undefined);
  const { items, people, files, now } = s.world;
  const status = req.nextUrl.searchParams.get('status');
  const team = req.nextUrl.searchParams.get('team');
  const views = toViews(items.filter((i) => scope.engineerIds.has(i.engineerId)), people, files, now).filter((v) => (!status || v.status === status) && (!team || v.team === team));
  const rows = [
    ['ref', 'case_number', 'engineer', 'email', 'team', 'status', 'files', 'case_closed', 'due', 'attested', 'attestation', 'reviewed'],
    ...views.map((v) => [v.ref, v.caseNumber, v.engineer.name, v.engineer.email, v.team, v.status, v.fileCount, v.caseClosedAt, v.dueAt, v.attestedAt ?? '', v.attestationKind ?? '', v.reviewedAt ?? '']),
  ];
  return new Response(rows.map((r) => r.map(esc).join(',')).join('\n'), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="items.csv"', 'cache-control': 'no-store' },
  });
}
