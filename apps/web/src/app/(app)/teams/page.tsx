import Link from 'next/link';
import { Users, ShieldCheck } from 'lucide-react';
import { OrgTree } from '@/components/dd/org-tree';
import { OrgToggle } from '@/components/dd/org-toggle';
import { Filters } from '@/components/dd/filters';
import { PageHeader } from '@/components/dd/kpi';
import { TeamTable, type TeamRow } from '@/components/dd/team-table';
import { applyFilters, first, requireRole } from '@/lib/session';
import { buildOrgTree, flattenTree, relativeTime, rollup } from '@/lib/metrics';
import { toRows } from '@/lib/tree-rows';
import { managerChain } from '@dd/shared';

export default async function Teams({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const s = await requireRole('compliance');
  const f = applyFilters(s, sp, 'compliance');
  const { people, now } = s.world;
  const view = first(sp.view) === 'flat' ? 'flat' : 'tree';
  const node = Number(first(sp.node));
  const division = first(sp.division);
  const slaF = first(sp.sla);
  const managerF = first(sp.manager);

  const tree = buildOrgTree(people, f.views, f.scope.rootId);
  if (!tree) return <p>No organization data.</p>;
  const all = flattenTree(tree);
  const focus = all.find((n) => n.person.id === node && n.children.length === 0 && n.depth > 0);
  const rows = toRows(tree, (n) => `/teams?node=${n.person.id}`).filter((r) => (!managerF || String(r.id) === managerF || r.depth === 0) && (!slaF || r.sla === null || r.sla < 94 || r.depth < 2));
  const trail = focus ? [{ label: 'Whole org' }, ...managerChain(people, focus.person.id).reverse().slice(1).map((m) => ({ label: m.team ?? m.name })), { label: focus.label }] : [{ label: 'Whole org' }, { label: tree.label }];

  if (focus) {
    const eng = people.filter((p) => p.managerId === focus.person.id && p.active);
    const trows: TeamRow[] = eng.map((p) => {
      const x = rollup(f.views.filter((v) => v.engineerId === p.id));
      const last = f.allViews.filter((v) => v.engineerId === p.id).flatMap((v) => [v.createdAt, v.acknowledgedAt, v.attestedAt]).filter((d): d is string => !!d).sort().at(-1);
      return { id: p.id, name: p.name, email: p.email, open: x.notClosed, overdue: x.overdue, closed: x.closed, sla: x.slaPct, last: last ? relativeTime(last, now) : '—', lastAt: last ?? '' };
    }).sort((a, b) => b.overdue - a.overdue);
    return (
      <>
        <PageHeader title={focus.label} subtitle="Explore ownership and compliance through the reporting hierarchy." />
        <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm">
          <span className="flex items-center gap-2"><Users className="size-4" aria-hidden />{trail.map((t, i) => <span key={i}>{i > 0 && <span className="mx-1.5 text-muted-foreground">/</span>}{i < trail.length - 1 ? <Link href="/teams" className="hover:underline">{t.label}</Link> : <strong>{t.label}</strong>}</span>)}</span>
          <OrgToggle value={view} />
        </div>
        <section className="max-w-3xl rounded-xl border bg-card">
          <div className="p-5 pb-3"><h2 className="text-lg font-semibold">Team activity</h2><p className="text-[13px] text-muted-foreground">{eng.length} engineers · Direct reports and sub-tree</p></div>
          <TeamTable rows={trows} reassignable={[]} />
          <p className="px-5 py-3 text-xs text-muted-foreground">Sorted by overdue, highest first</p>
        </section>
        <Access />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Teams" subtitle="Explore ownership and compliance through the reporting hierarchy." />
      <Filters fields={[
        { key: 'division', label: 'All divisions', options: people.filter((p) => p.managerId === tree.person.id).map((p) => ({ value: String(p.id), label: p.team ?? p.name })) },
        { key: 'manager', label: 'All managers', options: all.filter((n) => n.depth === 2).map((n) => ({ value: String(n.person.id), label: n.person.name })) },
        { key: 'sla', label: 'SLA: All', options: [{ value: 'below', label: 'Below 94%' }] },
      ]} />
      <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm">
        <span className="flex items-center gap-2"><Users className="size-4" aria-hidden />{trail.map((t, i) => <span key={i}>{i > 0 && <span className="mx-1.5 text-muted-foreground">/</span>}{t.label}</span>)}</span>
        <OrgToggle value={view} />
      </div>
      <section className="rounded-xl border bg-card">
        <OrgTree key={view + (division ?? '')} rows={division ? rows.filter((r) => r.depth === 0 || String(r.id) === division || r.parentId === Number(division) || rows.find((x) => x.id === r.parentId)?.parentId === Number(division)) : rows} defaultOpen={rows.filter((r) => r.depth < 2).map((r) => r.id)} flat={view === 'flat'} highlight={all.find((n) => n.depth === 2 && n.label === 'Platform')?.person.id} />
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">{all.filter((n) => n.children.length === 0).length} teams · {all.filter((n) => n.depth === 1).length} directors · Updated from the HR directory</p>
      </section>
      <Access />
    </>
  );
}

function Access() {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-accent px-5 py-4 text-accent-foreground">
      <ShieldCheck className="mt-0.5 size-5" aria-hidden />
      <div><div className="text-sm font-semibold">Access follows your reporting tree</div><p className="text-[13px] opacity-90">Managers see their direct reports and sub-tree. Compliance can review the whole organization.</p></div>
    </div>
  );
}
