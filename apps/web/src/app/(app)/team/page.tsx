import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, History, ShieldCheck } from 'lucide-react';
import { Kpi, PageHeader, ChartCard } from '@/components/dd/kpi';
import { StatusBadge } from '@/components/dd/status';
import { Aging, OpenOverTime, StatusByEngineer } from '@/components/dd/charts';
import { TeamTable, type TeamRow } from '@/components/dd/team-table';
import { Button } from '@/components/ui/button';
import { Filters } from '@/components/dd/filters';
import { applyFilters, requireRole, first } from '@/lib/session';
import { aging, days, openOverTime, pct, relativeTime, rollup, humanDue } from '@/lib/metrics';
import { childrenMap } from '@dd/shared';

export default async function MyTeam({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const s = await requireRole('manager', 'compliance');
  const f = applyFilters(s, sp, 'manager');
  const { people, now } = s.world;

  const sFilter = first(sp.status);
  const eFilter = first(sp.engineer);
  const slaFilter = first(sp.sla);
  const team = people.filter((p) => f.scope.engineerIds.has(p.id) && p.id !== f.scope.rootId && p.active && !(childrenMap(people).get(p.id)?.length));
  const matches = (v: (typeof f.views)[number]) => (!sFilter || v.status === sFilter) && (!eFilter || String(v.engineerId) === eFilter);
  const views = f.views.filter(matches);
  const r = rollup(views);

  const rows: TeamRow[] = team
    .filter((p) => !eFilter || String(p.id) === eFilter)
    .map((p) => {
      const mine = f.views.filter((v) => v.engineerId === p.id && (!sFilter || v.status === sFilter));
      const x = rollup(mine);
      const last = f.allViews.filter((v) => v.engineerId === p.id).flatMap((v) => [v.createdAt, v.acknowledgedAt, v.attestedAt]).filter((d): d is string => !!d).sort().at(-1);
      return { id: p.id, name: p.name, email: p.email, open: x.notClosed, overdue: x.overdue, closed: x.closed, sla: x.slaPct, last: last ? relativeTime(last, now) : '—', lastAt: last ?? '' };
    })
    .filter((row) => slaFilter !== 'below' || (row.sla !== null && row.sla < 94))
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open);

  const statusByEngineer = team.map((p) => {
    const x = rollup(f.views.filter((v) => v.engineerId === p.id));
    return { name: p.name.split(' ')[0]!, open: x.open, acknowledged: x.acknowledged, overdue: x.overdue };
  }).filter((d) => d.open + d.acknowledged + d.overdue > 0);

  const attention = views.filter((v) => v.status === 'overdue').sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 3);
  const overdueTotal = views.filter((v) => v.status === 'overdue').length;

  return (
    <>
      <PageHeader title="My team" subtitle={`A clear view of cleanup across ${f.scope.label}. Follow up where it matters.`} actions={<Button asChild variant="outline"><Link href="/reports">Export report</Link></Button>} />
      <Filters
        fields={[
          { key: 'engineer', label: 'All engineers', options: team.map((p) => ({ value: String(p.id), label: p.name })) },
          { key: 'status', label: 'All statuses', options: ['open', 'acknowledged', 'overdue', 'closed'].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) })) },
          { key: 'sla', label: 'SLA: All', options: [{ value: 'below', label: 'Below 94%' }] },
        ]}
      />
      <div className="grid grid-cols-5 gap-4">
        <Kpi label="Open items" value={r.notClosed} hint={`Across ${team.length} engineers`} icon={Clock} />
        <Kpi label="Overdue" value={r.overdue} hint="Needs a follow-up" icon={AlertTriangle} tone="danger" />
        <Kpi label="Closed rate" value={pct(r.closedRatePct)} hint={`${r.closed} of ${r.total} items`} icon={CheckCircle2} />
        <Kpi label="Median time to close" value={days(r.medianDaysToClose)} hint="Within the 3-day SLA" icon={History} />
        <Kpi label="SLA met" value={pct(r.slaPct)} hint={`${r.closedOnTime} of ${r.closed} closures`} icon={ShieldCheck} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <ChartCard title="Status by engineer"><StatusByEngineer data={statusByEngineer} /></ChartCard>
        <ChartCard title="Open items over time" subtitle={`${r.notClosed} open today`}><OpenOverTime data={openOverTime(f.allViews, f.range)} /></ChartCard>
        <ChartCard title="Item aging" subtitle="Open items · age since case closed"><Aging data={aging(f.allViews, now)} /></ChartCard>
      </div>
      <div className="grid grid-cols-[1fr_340px] gap-4">
        <section className="rounded-xl border bg-card">
          <div className="p-5 pb-3"><h2 className="text-lg font-semibold">Team activity</h2><p className="text-[13px] text-muted-foreground">{team.length} engineers · Direct reports and sub-tree</p></div>
          <TeamTable rows={rows} reassignable={people.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }))} />
          <p className="px-5 py-3 text-xs text-muted-foreground">Sorted by overdue, highest first</p>
        </section>
        <section className="self-start rounded-xl border bg-card p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><AlertTriangle className="size-5 text-destructive" aria-hidden />Needs attention</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{overdueTotal} overdue · oldest first</p>
          {attention.length === 0 && <p className="mt-6 text-sm text-muted-foreground">Nothing is overdue. Nice work.</p>}
          <ul className="mt-3 divide-y">
            {attention.map((v) => (
              <li key={v.id} className="py-4">
                <div className="flex items-start justify-between gap-2"><span className="font-semibold">Case #{v.caseNumber}</span><StatusBadge status="overdue" /></div>
                <div className="mt-1 text-sm text-muted-foreground">{v.engineer.name} · {humanDue(v.dueAt, now, v.state).text.split(' · ')[1]}</div>
                <Link href={`/items/${v.id}`} className="mt-1.5 inline-block text-sm text-primary hover:underline">View item ↗</Link>
              </li>
            ))}
          </ul>
          {overdueTotal > 0 && <Button asChild variant="outline" className="mt-2"><Link href="/items?status=overdue">View all {overdueTotal} items</Link></Button>}
        </section>
      </div>
    </>
  );
}
