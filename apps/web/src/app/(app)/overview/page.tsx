import Link from 'next/link';
import { ShieldCheck, Upload, AlertTriangle, XCircle } from 'lucide-react';
import { ChartCard, Kpi, PageHeader } from '@/components/dd/kpi';
import { Heatmap, IngestedVsClosed, SlaByTeam, StatusDistribution } from '@/components/dd/charts';
import { OrgTree } from '@/components/dd/org-tree';
import { OrgToggle } from '@/components/dd/org-toggle';
import { Filters } from '@/components/dd/filters';
import { RetryAll } from '@/components/dd/item-actions';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/dd/status';
import { applyFilters, first, getStore, requireRole } from '@/lib/session';
import { buildOrgTree, days, fmtUtc, leafTeams, overdueHeatmap, pct, rollup, weekly } from '@/lib/metrics';
import { toRows } from '@/lib/tree-rows';

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const s = await requireRole('compliance');
  const f = applyFilters(s, sp, 'compliance');
  const { people, now } = s.world;
  const division = first(sp.division);
  const statusF = first(sp.status);
  const manager = first(sp.manager);

  let views = f.views;
  if (division) { const ids = new Set(people.filter((p) => String(p.managerId) === division || String(p.id) === division).map((p) => p.id)); views = views.filter((v) => { for (let p: typeof v.engineer | undefined = v.engineer; p; p = people.find((x) => x.id === p!.managerId)) if (String(p.id) === division) return true; return ids.has(v.engineerId); }); }
  if (statusF) views = views.filter((v) => v.status === statusF);
  if (manager) views = views.filter((v) => String(v.engineer.managerId) === manager);

  const r = rollup(views);
  const tree = buildOrgTree(people, views, f.scope.rootId);
  const store = await getStore();
  const [imports, issues] = await Promise.all([store.listImports(1), store.listIssues({ unresolvedOnly: true })]);
  const last = imports[0];
  const triage = issues.filter((i) => i.kind === 'triage').length;
  const failed = issues.filter((i) => i.kind === 'failed').length;
  const teams = tree ? leafTeams(tree).filter((t) => t.depth > 0) : [];
  const sla = teams.filter((t) => t.rollup.slaPct !== null).map((t) => ({ team: t.label, pct: t.rollup.slaPct! })).sort((a, b) => b.pct - a.pct);
  const wk = weekly(f.allViews, f.range);
  const flow = wk.map((w) => ({ week: w.weekEnding, ingested: w.ingested, closed: w.closed }));
  const heat = overdueHeatmap(f.allViews, teams.map((t) => t.label), f.range);
  const openNow = f.allViews.filter((v) => v.status === 'open').length;
  const managers = people.filter((p) => people.some((x) => x.managerId === p.id && !people.some((y) => y.managerId === x.id)));
  const divisions = people.filter((p) => p.managerId === (f.scope.trail[0]?.id ?? -1) && people.some((x) => x.managerId === p.id));
  const rows = tree ? toRows(tree, (n) => `/teams?node=${n.person.id}`) : [];

  return (
    <>
      <PageHeader title="Overview" subtitle="Every download accounted for. Every closure backed by an attestation." actions={<Button asChild variant="outline"><a href={`/api/items.csv?scope=${f.scope.rootId}`}>Export summary</a></Button>} />
      <Filters fields={[
        { key: 'division', label: 'All divisions', options: divisions.map((d) => ({ value: String(d.id), label: d.team ?? d.name })) },
        { key: 'status', label: 'All statuses', options: ['open', 'acknowledged', 'overdue', 'closed'].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) })) },
        { key: 'manager', label: 'All managers', options: managers.map((m) => ({ value: String(m.id), label: m.name })) },
      ]} />

      <section className="grid grid-cols-[1.1fr_1fr_1fr_1fr] items-center gap-6 rounded-xl border bg-card p-6" aria-label="Headline">
        <div className="flex items-start gap-4 border-r pr-6">
          <ShieldCheck className="mt-1 size-6 text-primary" aria-hidden />
          <div><div className="text-sm text-muted-foreground">Total cleanup items processed</div><div className="text-5xl font-semibold tracking-tight">{r.total}</div></div>
        </div>
        <div><div className="text-3xl font-semibold">{r.closed}</div><div className="text-sm text-muted-foreground">Attested and closed</div></div>
        <div><div className="text-3xl font-semibold">{pct(r.closedRatePct)}</div><div className="text-sm text-muted-foreground">Closed this period</div></div>
        <div><StatusBadge status="closed" /><div className="mt-2 text-sm text-muted-foreground">One item per engineer + case</div></div>
      </section>

      <div className="grid grid-cols-5 gap-4">
        <Kpi label="Open items" value={r.notClosed} hint={`${r.open + r.acknowledged} on time · ${r.overdue} overdue`} />
        <Kpi label="Overdue" value={r.overdue} hint={`Across ${teams.filter((t) => t.rollup.overdue > 0).length} teams`} />
        <Kpi label="Closed rate" value={pct(r.closedRatePct)} hint={`${r.closed} of ${r.total} processed`} />
        <Kpi label="Median time to close" value={days(r.medianDaysToClose)} hint="3-day policy" />
        <Kpi label="SLA met" value={pct(r.slaPct)} hint={`${r.closedOnTime} of ${r.closed} closures`} />
      </div>

      <div className="grid grid-cols-[1fr_340px] gap-4">
        <section className="rounded-xl border bg-card">
          <div className="flex items-start justify-between p-5 pb-3">
            <div><h2 className="text-lg font-semibold">Organization health</h2><p className="text-[13px] text-muted-foreground">{f.scope.trail.map((t) => t.label).join(' / ')}</p></div>
            <OrgToggle value="tree" />
          </div>
          <OrgTree rows={rows} defaultOpen={rows.filter((r) => r.depth < 2).map((r) => r.id)} />
          <div className="border-t px-5 py-3 text-[13px]"><Link href="/teams" className="text-primary hover:underline">View all {teams.length} teams →</Link></div>
        </section>
        <section className="self-start rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-lg font-semibold"><Upload className="size-4" aria-hidden />Ingestion health</h2>{last && <StatusBadge status="closed" />}</div>
          {last ? (
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="text-muted-foreground">Last report received</dt><dd className="font-medium">{fmtUtc(last.receivedAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Rows received</dt><dd className="tabular-nums">{last.rowsTotal}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Duplicates skipped</dt><dd className="tabular-nums">{last.duplicateRows}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Cleanup items created</dt><dd className="tabular-nums">{last.itemsCreated}</dd></div>
            </dl>
          ) : <p className="mt-4 text-sm text-muted-foreground">No report received yet.</p>}
          <div className="mt-4 flex items-center justify-between border-t pt-4 text-sm"><StatusBadge status="triage" /><span className="tabular-nums">{triage}</span><StatusBadge status="failed" /><span className="tabular-nums">{failed}</span></div>
          {triage > 0 && <p className="mt-3 text-[13px] text-muted-foreground">{triage} user{triage === 1 ? '' : 's'} need Slack mapping</p>}
          <div className="mt-3 flex items-center justify-between"><RetryAll count={failed} /><Link href="/ingestion" className="text-sm text-primary hover:underline">View ingestion →</Link></div>
        </section>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="SLA compliance by team" subtitle="Closed within SLA · sorted highest first"><SlaByTeam data={sla} /></ChartCard>
        <ChartCard title="Weekly ingestion and closure"><IngestedVsClosed data={flow} /></ChartCard>
        <ChartCard title="Status distribution" subtitle={`${r.total} items · Status at end of period`}>
          <StatusDistribution parts={[
            { key: 'closed', label: 'Closed', value: r.closed, color: 'var(--chart-2)' },
            { key: 'open', label: 'Open', value: r.open + r.triage + r.failed, color: 'var(--chart-3)' },
            { key: 'ack', label: 'Acknowledged', value: r.acknowledged, color: 'var(--chart-1)' },
            { key: 'overdue', label: 'Overdue', value: r.overdue, color: 'var(--chart-4)' },
          ]} />
        </ChartCard>
        <ChartCard title="Overdue by team and week" subtitle="Darker cells mean more overdue items"><Heatmap weeks={heat.weeks} rows={heat.rows} /></ChartCard>
      </div>
      <p className="text-xs text-muted-foreground">Daily CSV ingestion · Salesforce cases · Slack is the action channel, Downloads Detective is the system of record</p>
      <span className="hidden"><AlertTriangle /><XCircle />{openNow}</span>
    </>
  );
}
