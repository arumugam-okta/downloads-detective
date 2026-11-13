import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/dd/kpi';
import { StatusBadge } from '@/components/dd/status';
import { canSee, getSession } from '@/lib/session';
import { humanDue, relativeTime, rollup, toViews } from '@/lib/metrics';

export default async function Person({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const { people, items, files, now } = s.world;
  const p = people.find((x) => x.id === Number(id));
  if (!p || !canSee(s, p.id)) notFound();
  const views = toViews(items.filter((i) => i.engineerId === p.id), people, files, now).sort((a, b) => ({ closed: 1 } as Record<string, number>)[a.status]! - ({ closed: 1 } as Record<string, number>)[b.status]! || a.dueAt.localeCompare(b.dueAt));
  const r = rollup(views);
  const last = views.flatMap((v) => [v.createdAt, v.acknowledgedAt, v.attestedAt]).filter((d): d is string => !!d).sort().at(-1);
  return (
    <>
      <PageHeader title={p.name} subtitle={`${p.email} · ${p.team ?? 'Engineer'}`} />
      <p className="text-sm text-muted-foreground">{r.notClosed} open items · {r.overdue} overdue · {r.closed} closed{last ? ` · last activity ${relativeTime(last, now)}` : ''}</p>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-lg font-semibold">Cleanup items</h2>
        <ul className="mt-3 space-y-3">
          {views.slice(0, 30).map((v) => (
            <li key={v.id} className="flex items-start justify-between rounded-lg border p-4">
              <div><Link href={`/items/${v.id}`} className="font-semibold hover:underline">Case #{v.caseNumber}</Link><div className="text-sm text-muted-foreground">{v.status === 'closed' ? 'Closed' : humanDue(v.dueAt, now, v.state).text.split(' · ')[1]}</div></div>
              <StatusBadge status={v.status} />
            </li>
          ))}
          {views.length === 0 && <li className="text-sm text-muted-foreground">No cleanup items.</li>}
        </ul>
      </section>
    </>
  );
}
