import Link from 'next/link';
import { Download } from 'lucide-react';
import { PageHeader } from '@/components/dd/kpi';
import { StatusBadge } from '@/components/dd/status';
import { Filters } from '@/components/dd/filters';
import { Button } from '@/components/ui/button';
import { applyFilters, first, requireRole } from '@/lib/session';
import { fmtShort, rollup } from '@/lib/metrics';
import { cn } from '@/lib/utils';

const PAGE = 25;
const ORDER: Record<string, number> = { overdue: 0, failed: 1, triage: 2, acknowledged: 3, open: 4, closed: 5 };

export default async function Items({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const s = await requireRole('manager', 'compliance');
  const f = applyFilters(s, sp);
  const status = first(sp.status);
  const team = first(sp.team);
  const eng = first(sp.engineer);
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const base = f.allViews;
  const filtered = base
    .filter((v) => (!status || v.status === status) && (!team || v.team === team) && (!eng || String(v.engineerId) === eng))
    .sort((a, b) => ORDER[a.status]! - ORDER[b.status]! || a.dueAt.localeCompare(b.dueAt));
  const r = rollup(base);
  const teams = [...new Set(base.map((v) => v.team))].sort();
  const engineers = [...new Map(base.map((v) => [v.engineerId, v.engineer.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const slice = filtered.slice((page - 1) * PAGE, page * PAGE);
  const href = (p: number) => { const n = new URLSearchParams(); for (const [k, v] of Object.entries(sp)) if (typeof v === 'string' && k !== 'page') n.set(k, v); n.set('page', String(p)); return `/items?${n}`; };
  const csv = `/api/items.csv?${new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : []))).toString()}`;

  return (
    <>
      <PageHeader title="Items" subtitle="One record per engineer and case. Review evidence, ownership and exceptions." actions={<Button asChild variant="outline"><a href={csv}><Download className="size-4" />Export CSV</a></Button>} />
      <Filters fields={[
        { key: 'team', label: 'All teams', options: teams.map((t) => ({ value: t, label: t })) },
        { key: 'status', label: 'All statuses', options: ['open', 'acknowledged', 'overdue', 'closed', 'triage', 'failed'].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) })) },
        { key: 'engineer', label: 'All engineers', options: engineers.map(([id, name]) => ({ value: String(id), label: name })) },
      ]} />
      <div className="grid grid-cols-4 gap-4">
        {([['open', 'Open', r.open + r.triage + r.failed], ['acknowledged', 'Acknowledged', r.acknowledged], ['overdue', 'Overdue', r.overdue], ['closed', 'Closed', r.closed]] as const).map(([k, , n]) => (
          <div key={k} className="flex items-center justify-between rounded-xl border bg-card px-4 py-4"><StatusBadge status={k} /><span className="text-[28px] font-semibold tabular-nums">{n}</span></div>
        ))}
      </div>
      <section className="rounded-xl border bg-card">
        <div className="p-5 pb-3"><h2 className="font-semibold">{r.notClosed + r.triage + r.failed} open · {r.closed} closed</h2><p className="text-[13px] text-muted-foreground">Sorted by overdue, then due date</p></div>
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground"><tr>{['Case number', 'Engineer', 'Team', 'Files', 'Status', 'Due date'].map((h) => <th key={h} className="px-5 py-2 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {slice.map((v) => (
              <tr key={v.id} className="border-t hover:bg-accent/40">
                <td className="px-5 py-2.5"><Link href={`/items/${v.id}`} className="font-medium text-primary hover:underline">#{v.caseNumber}</Link></td>
                <td className="px-5">{v.engineer.name}</td>
                <td className="px-5 text-muted-foreground">{v.team}</td>
                <td className="px-5 text-muted-foreground">{v.fileCount} file{v.fileCount === 1 ? '' : 's'}</td>
                <td className="px-5"><StatusBadge status={v.status === 'closed' && v.attestationKind !== 'deleted' && !v.reviewedAt ? 'pending_review' : v.status} /></td>
                <td className={cn('px-5 tabular-nums', v.status === 'overdue' && 'text-destructive')}>{fmtShort(v.dueAt)}</td>
              </tr>
            ))}
            {slice.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">No items match these filters.</td></tr>}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t px-5 py-3 text-sm text-muted-foreground">
          <span>Showing {slice.length} of {filtered.length} items</span>
          <div className="flex gap-2">
            <Button asChild variant="outline" aria-disabled={page <= 1} className={cn(page <= 1 && 'pointer-events-none opacity-50')}><Link href={href(page - 1)}>Previous</Link></Button>
            <Button asChild variant="outline" aria-disabled={page * PAGE >= filtered.length} className={cn(page * PAGE >= filtered.length && 'pointer-events-none opacity-50')}><Link href={href(page + 1)}>Next</Link></Button>
          </div>
        </div>
      </section>
      <p className="text-xs text-muted-foreground">Attestations are immutable. Corrections are appended as review events in the audit log.</p>
    </>
  );
}
