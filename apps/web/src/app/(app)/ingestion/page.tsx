import { FileText } from 'lucide-react';
import { Kpi, PageHeader } from '@/components/dd/kpi';
import { StatusBadge } from '@/components/dd/status';
import { Filters } from '@/components/dd/filters';
import { RetryAll, RetryButtons } from '@/components/dd/item-actions';
import { UploadReport } from '@/components/dd/upload';
import { first, getStore, requireRole } from '@/lib/session';
import { fmtUtc } from '@/lib/metrics';

export default async function Ingestion({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const s = await requireRole('compliance');
  const store = await getStore();
  const [imports, issues] = await Promise.all([store.listImports(30), store.listIssues({ unresolvedOnly: true })]);
  const report = first(sp.report);
  const outcome = first(sp.outcome);
  const source = first(sp.source);
  const shown = imports.filter((i) => (!report || String(i.id) === report) && (!source || i.source === source));
  const latest = (report ? imports.find((i) => String(i.id) === report) : imports[0]) ?? imports[0];
  const { items, people } = s.world;
  const byId = new Map(people.map((p) => [p.id, p]));
  const visible = issues.filter((i) => (!outcome || i.kind === outcome) && (!report || String(i.importId) === report));
  const failed = issues.filter((i) => i.kind === 'failed').length;
  const triage = issues.filter((i) => i.kind === 'triage').length;

  return (
    <>
      <PageHeader title="Ingestion" subtitle="Daily Salesforce reports, grouped into accountable cleanup items." actions={<><UploadReport /><RetryAll count={failed} /></>} />
      <Filters fields={[
        { key: 'report', label: 'All reports', options: imports.map((i) => ({ value: String(i.id), label: i.filename })) },
        { key: 'outcome', label: 'All outcomes', options: [{ value: 'triage', label: 'Needs triage' }, { value: 'failed', label: 'Failed' }] },
        { key: 'source', label: 'All sources', options: [...new Set(imports.map((i) => i.source))].map((v) => ({ value: v, label: v })) },
      ]} />
      <div className="grid grid-cols-5 gap-4">
        <Kpi label="Last received" value={latest ? latest.receivedAt.slice(11, 16) + ' UTC' : '—'} />
        <Kpi label="Report rows" value={latest?.rowsTotal ?? 0} />
        <Kpi label="Duplicates skipped" value={latest?.duplicateRows ?? 0} />
        <Kpi label="Needs triage" value={triage} />
        <Kpi label="Failed rows" value={failed} />
      </div>

      {latest && (
        <section className="rounded-xl border bg-card p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3"><FileText className="mt-0.5 size-6 text-primary" aria-hidden /><div><h2 className="text-lg font-semibold">{latest.filename}</h2><p className="text-[13px] text-muted-foreground">Received {fmtUtc(latest.receivedAt)} · {latest.itemsCreated} cleanup items created</p></div></div>
            <StatusBadge status={latest.failures > 0 ? 'failed' : 'closed'} />
          </div>
          <div className="mt-4 border-t pt-4 text-sm"><span className="text-muted-foreground">Required columns</span><span className="ml-8">Case number · Downloaded by · Downloaded on · Filename</span></div>
          <p className="mt-2 text-xs text-muted-foreground">Grouping key: engineer + case. Re-importing the same report does not create duplicate items.</p>
        </section>
      )}

      <section className="rounded-xl border bg-card">
        <div className="p-5 pb-3"><h2 className="text-lg font-semibold">Needs a closer look</h2><p className="text-[13px] text-muted-foreground">{triage} unresolved Slack user{triage === 1 ? '' : 's'} · {failed} delivery failure{failed === 1 ? '' : 's'}</p></div>
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground"><tr>{['Row', 'Downloaded by', 'Issue', 'Status', 'Action'].map((h) => <th key={h} className="px-5 py-2 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {visible.map((i) => {
              const item = items.find((x) => x.id === i.itemId);
              const person = item ? byId.get(item.engineerId) : null;
              return (
                <tr key={i.id} className="border-t">
                  <td className="px-5 py-3 tabular-nums">{i.rowNo ?? '—'}</td>
                  <td className="px-5">{i.downloadedBy}</td>
                  <td className="px-5 text-muted-foreground">{i.issue}</td>
                  <td className="px-5"><StatusBadge status={i.kind} /></td>
                  <td className="px-5">{item && person ? <RetryButtons itemId={item.id} personId={person.id} canMap={i.kind === 'triage'} /> : <span className="text-xs text-muted-foreground">Fix the source row</span>}</td>
                </tr>
              );
            })}
            {visible.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-muted-foreground">Nothing needs attention.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border bg-card">
        <div className="p-5 pb-3"><h2 className="text-lg font-semibold">Report history</h2></div>
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground"><tr>{['Report', 'Received', 'Rows', 'Duplicates', 'Items created', 'Failures'].map((h) => <th key={h} className="px-5 py-2 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody>{shown.map((i) => <tr key={i.id} className="border-t"><td className="px-5 py-2.5">{i.filename}</td><td className="px-5 text-muted-foreground">{fmtUtc(i.receivedAt)}</td><td className="px-5 tabular-nums">{i.rowsTotal}</td><td className="px-5 tabular-nums">{i.duplicateRows}</td><td className="px-5 tabular-nums">{i.itemsCreated}</td><td className="px-5 tabular-nums">{i.failures}</td></tr>)}</tbody>
        </table>
      </section>
      <p className="text-xs text-muted-foreground">Source reports are retained for 90 days. All imports, retries and mappings are recorded in the audit log.</p>
    </>
  );
}
