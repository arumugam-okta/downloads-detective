import Link from 'next/link';
import { CalendarDays, CheckCircle2, Clock, MessageSquare, ShieldCheck } from 'lucide-react';
import { ATTESTATION_LABEL } from '@dd/shared';
import { Kpi, PageHeader } from '@/components/dd/kpi';
import { StatusBadge } from '@/components/dd/status';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { getSession, first } from '@/lib/session';
import { fmtUtc, humanDue, toViews } from '@/lib/metrics';

const PAGE = 10;

export default async function History({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const s = await getSession();
  const { now, items, files, people } = s.world;
  const me = s.viewer.person;
  const mine = toViews(items.filter((i) => i.engineerId === me.id), people, files, now);
  const open = mine.filter((v) => v.state !== 'closed').sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const closed = mine.filter((v) => v.state === 'closed' && v.attestedAt).sort((a, b) => b.attestedAt!.localeCompare(a.attestedAt!));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const thisMonth = closed.filter((v) => new Date(v.attestedAt!) >= monthStart).length;
  const due = open[0] ? humanDue(open[0].dueAt, now, open[0].state) : null;
  const limit = Math.max(PAGE, Number(first(sp.n)) || PAGE);
  const shown = closed.slice(0, limit);

  return (
    <>
      <PageHeader
        title="History"
        subtitle="Your cleanup record. Every attestation, kept in one place."
        actions={<span className="flex items-center gap-1.5 text-[13px] text-muted-foreground"><MessageSquare className="size-4" />Also available in Slack</span>}
      />
      <div className="grid grid-cols-3 gap-4">
        <Kpi label="Items open" value={open.length} icon={Clock} />
        <Kpi label="Due soonest" value={due ? due.text.split(' · ')[1] : '—'} icon={CalendarDays} tone={due?.overdue ? 'danger' : undefined} />
        <Kpi label="Closed this month" value={thisMonth} icon={CheckCircle2} />
      </div>
      <Tabs value="history">
        <TabsList>
          <TabsTrigger value="open" asChild><Link href="/cleanup">Open · {open.length}</Link></TabsTrigger>
          <TabsTrigger value="history" asChild><Link href="/history">History · {closed.length}</Link></TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="text-sm text-muted-foreground">{closed.length} closed item{closed.length === 1 ? '' : 's'}</p>
      {closed.length === 0 && (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Nothing here yet. Your attestations will appear once you confirm a cleanup.</p>
      )}
      <div className="space-y-4">
        {shown.map((v) => (
          <article key={v.id} className="rounded-xl border bg-card p-5">
            <div className="flex items-start justify-between">
              <div>
                <Link href={`/items/${v.id}`} className="text-lg font-semibold hover:underline">Case #{v.caseNumber}</Link>
                <div className="mt-1 text-sm text-muted-foreground">{fmtUtc(v.attestedAt!)}</div>
              </div>
              <StatusBadge status="closed" />
            </div>
            <div className="mt-3 flex items-start gap-3 rounded-lg bg-muted px-4 py-3">
              <ShieldCheck className="mt-0.5 size-4 text-st-closed" aria-hidden />
              <div className="text-sm">
                <div className="font-medium">{v.attestationKind ? `${ATTESTATION_LABEL[v.attestationKind]}.` : 'Resolved.'}</div>
                {v.attestationNotes && <div className="text-muted-foreground">{v.attestationNotes}</div>}
              </div>
            </div>
          </article>
        ))}
      </div>
      {closed.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Showing {shown.length} of {closed.length} attestations</span>
          {shown.length < closed.length && <Button asChild variant="outline"><Link href={`/history?n=${limit + PAGE}`}>Load more</Link></Button>}
        </div>
      )}
    </>
  );
}
