import { Download } from 'lucide-react';
import { ChartCard, PageHeader } from '@/components/dd/kpi';
import { Aging, OpenOverTime, StatusByEngineer } from '@/components/dd/charts';
import { Filters } from '@/components/dd/filters';
import { Button } from '@/components/ui/button';
import { applyFilters, first, requireRole } from '@/lib/session';
import { aging, days, openOverTime, pct, rollup, weekly } from '@/lib/metrics';
import { childrenMap } from '@dd/shared';

export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const s = await requireRole('manager', 'compliance');
  const f = applyFilters(s, sp, 'manager');
  const eng = first(sp.engineer);
  const { people, now } = s.world;
  const kids = childrenMap(people);
  const team = people.filter((p) => f.scope.engineerIds.has(p.id) && p.id !== f.scope.rootId && p.active && !kids.get(p.id)?.length);
  const views = f.views.filter((v) => !eng || String(v.engineerId) === eng);
  const all = f.allViews.filter((v) => !eng || String(v.engineerId) === eng);
  const rows = weekly(all, f.range).reverse().slice(0, 8);
  const r = rollup(views);
  const byEng = team.filter((p) => !eng || String(p.id) === eng).map((p) => { const x = rollup(f.views.filter((v) => v.engineerId === p.id)); return { name: p.name.split(' ')[0]!, open: x.open, acknowledged: x.acknowledged, overdue: x.overdue }; }).filter((d) => d.open + d.acknowledged + d.overdue > 0);

  return (
    <>
      <PageHeader title="Reports" subtitle="Team performance and SLA outcomes." actions={<Button asChild variant="outline"><a href={`/api/items.csv?scope=${f.scope.rootId}`}><Download className="size-4" />Export report</a></Button>} />
      <Filters fields={[{ key: 'engineer', label: 'All engineers', options: team.map((p) => ({ value: String(p.id), label: p.name })) }]} />
      <div className="grid grid-cols-3 gap-4">
        <ChartCard title="Status by engineer"><StatusByEngineer data={byEng} /></ChartCard>
        <ChartCard title="Open items over time" subtitle={`${r.notClosed} open today`}><OpenOverTime data={openOverTime(all, f.range)} /></ChartCard>
        <ChartCard title="Item aging" subtitle="Open items · age since case closed"><Aging data={aging(all, now)} /></ChartCard>
      </div>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-lg font-semibold">Weekly outcomes</h2>
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-muted-foreground"><tr>{['Week ending', 'Ingested', 'Closed', 'Overdue', 'Median close', 'SLA met'].map((h) => <th key={h} className="py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.weekEnding} className="border-t">
                <td className="py-3">{new Date(`${w.weekEnding}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</td>
                <td className="tabular-nums">{w.ingested}</td><td className="tabular-nums">{w.closed}</td><td className="tabular-nums">{w.overdue}</td>
                <td className="tabular-nums">{days(w.medianDays)}</td><td className="tabular-nums">{pct(w.slaPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-xs text-muted-foreground">Closed rate = closed / total items. SLA met = closures completed within the 3-day policy / all closures.</p>
      </section>
    </>
  );
}
