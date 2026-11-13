import Link from 'next/link';
import { Download } from 'lucide-react';
import { PageHeader } from '@/components/dd/kpi';
import { Filters } from '@/components/dd/filters';
import { Button } from '@/components/ui/button';
import { first, getStore, requireRole } from '@/lib/session';
import { fmtUtc } from '@/lib/metrics';
import { resolveRange } from '@/lib/session';

const PAGE = 10;

export default async function Audit({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const s = await requireRole('compliance');
  const store = await getStore();
  const range = resolveRange(s.world.now, first(sp.from), first(sp.to));
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const actor = first(sp.actor);
  const action = first(sp.action);
  const itemQ = first(sp.item);
  const base = { from: range.from.toISOString(), to: range.to.toISOString() };
  const { total, events } = await store.listAudit({ ...base, ...(actor ? { actorLabel: actor } : {}), ...(action ? { action } : {}), ...(itemQ ? { itemId: Number(itemQ) } : {}), limit: PAGE, offset: (page - 1) * PAGE });
  const wide = await store.listAudit({ ...base, limit: 3000, offset: 0 });
  const actors = [...new Set(wide.events.map((e) => e.actorLabel))].sort();
  const actions = [...new Set(wide.events.map((e) => e.action))].sort();
  const itemById = new Map(s.world.items.map((i) => [i.id, i]));
  const href = (p: number) => { const n = new URLSearchParams(); for (const [k, v] of Object.entries(sp)) if (typeof v === 'string' && k !== 'page') n.set(k, v); n.set('page', String(p)); return `/audit?${n}`; };

  return (
    <>
      <PageHeader title="Audit log" subtitle="A permanent record of who did what, when, and to which item." actions={<Button asChild variant="outline"><a href={`/api/audit.csv?${new URLSearchParams({ from: range.fromStr, to: range.toStr, ...(actor ? { actor } : {}), ...(action ? { action } : {}) })}`}><Download className="size-4" />Export audit log</a></Button>} />
      <Filters fields={[
        { key: 'actor', label: 'All actors', options: actors.map((a) => ({ value: a, label: a })) },
        { key: 'action', label: 'All event types', options: actions.map((a) => ({ value: a, label: a.replace(/_/g, ' ') })) },
      ]} />
      <section className="rounded-xl border bg-card">
        <div className="p-5 pb-3"><h2 className="text-lg font-semibold">Organization activity</h2><p className="text-[13px] text-muted-foreground">UTC timestamps · newest first · append-only</p></div>
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground"><tr>{['Who', 'What', 'When (UTC)', 'Item'].map((h) => <th key={h} className="px-5 py-2 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {events.map((e) => {
              const item = e.itemId ? itemById.get(e.itemId) : null;
              return (
                <tr key={e.id} className="border-t">
                  <td className="px-5 py-3">{e.actorLabel}</td>
                  <td className="px-5">{e.detail ?? e.action.replace(/_/g, ' ')}</td>
                  <td className="px-5 text-muted-foreground tabular-nums">{fmtUtc(e.at).replace(' UTC', '')}</td>
                  <td className="px-5">{item ? <Link href={`/items/${item.id}`} className="text-primary hover:underline">Case #{item.caseNumber}</Link> : e.importId ? <Link href="/ingestion" className="text-primary hover:underline">Report #{e.importId}</Link> : <span className="text-muted-foreground">—</span>}</td>
                </tr>
              );
            })}
            {events.length === 0 && <tr><td colSpan={4} className="px-5 py-10 text-center text-muted-foreground">No events match these filters.</td></tr>}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t px-5 py-3 text-sm text-muted-foreground">
          <span>Showing {events.length} of {total.toLocaleString()} events</span>
          <div className="flex gap-2">
            {page > 1 && <Button asChild variant="outline"><Link href={href(page - 1)}>Previous</Link></Button>}
            {page * PAGE < total && <Button asChild variant="outline"><Link href={href(page + 1)}>Next page</Link></Button>}
          </div>
        </div>
      </section>
    </>
  );
}
