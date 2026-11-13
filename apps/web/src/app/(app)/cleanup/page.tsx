import Link from 'next/link';
import { CalendarDays, CheckCircle2, Clock, FileText, MessageSquare, ShieldCheck } from 'lucide-react';
import { Kpi, PageHeader } from '@/components/dd/kpi';
import { StatusBadge } from '@/components/dd/status';
import { EngineerActions } from '@/components/dd/item-actions';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { getSession, first } from '@/lib/session';
import { fmtShort, fmtUtc, humanDue, toViews } from '@/lib/metrics';
import { cn } from '@/lib/utils';

export default async function MyCleanup({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const s = await getSession();
  const { now, items, files, people } = s.world;
  const me = s.viewer.person;
  const mine = toViews(items.filter((i) => i.engineerId === me.id), people, files, now);
  const open = mine.filter((v) => v.state !== 'closed').sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const closed = mine.filter((v) => v.state === 'closed');
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const closedThisMonth = closed.filter((v) => v.attestedAt && new Date(v.attestedAt) >= monthStart).length;
  const soonest = open[0];
  const soonestDue = soonest ? humanDue(soonest.dueAt, now, soonest.state) : null;
  const q = (first(sp.q) ?? '').toLowerCase();
  const shown = open.filter(
    (v) => !q || `${v.caseNumber} ${v.caseSubject ?? ''}`.toLowerCase().includes(q) || files.some((f) => f.itemId === v.id && f.filename.toLowerCase().includes(q)),
  );
  const lastAttested = closed.map((v) => v.attestedAt!).sort().at(-1);

  return (
    <>
      <PageHeader
        title="My cleanup"
        subtitle={`Hi ${me.name.split(' ')[0]}. A few minutes of cleanup keeps customer data safe.`}
        actions={<span className="flex items-center gap-1.5 text-[13px] text-muted-foreground"><MessageSquare className="size-4" />Also available in Slack</span>}
      />
      <div className="grid grid-cols-3 gap-4">
        <Kpi label="Items open" value={open.length} icon={Clock} />
        <Kpi
          label="Due soonest"
          value={soonestDue ? <span className={cn(soonestDue.overdue && 'text-destructive')}>{soonestDue.text.split(' · ')[1]}</span> : '—'}
          icon={CalendarDays}
          tone={soonestDue?.overdue ? 'danger' : undefined}
        />
        <Kpi label="Closed this month" value={closedThisMonth} icon={CheckCircle2} />
      </div>
      <Tabs value="open">
        <TabsList>
          <TabsTrigger value="open" asChild><Link href="/cleanup">Open · {open.length}</Link></TabsTrigger>
          <TabsTrigger value="history" asChild><Link href="/history">History · {closed.length}</Link></TabsTrigger>
        </TabsList>
      </Tabs>

      {open.length === 0 ? (
        <div className="grid place-items-center rounded-xl border bg-card px-6 py-16 text-center">
          <div className="grid size-16 place-items-center rounded-full bg-st-closed-bg text-st-closed"><ShieldCheck className="size-8" /></div>
          <h2 className="mt-4 text-2xl font-semibold">You’re all clear!</h2>
          <p className="mt-2 text-sm text-muted-foreground">Every local copy accounted for. Thanks for closing the loop.</p>
          <p className="text-sm text-muted-foreground">New cleanup items will arrive here and in Slack.</p>
          <Button asChild variant="outline" className="mt-6"><Link href="/history">View cleanup history</Link></Button>
          {lastAttested && <p className="mt-8 text-xs text-muted-foreground">Your last cleanup was attested on {fmtUtc(lastAttested)}.</p>}
        </div>
      ) : (
        <div className="space-y-4">
          {shown.length === 0 && <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">No items match your search.</p>}
          {shown.map((v) => {
            const fs = files.filter((f) => f.itemId === v.id);
            const due = humanDue(v.dueAt, now, v.state);
            return (
              <article key={v.id} className="rounded-xl border bg-card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <Link href={`/items/${v.id}`} className="text-lg font-semibold hover:underline">Case #{v.caseNumber}</Link>
                    {v.caseSubject && <span className="text-sm text-muted-foreground">{v.caseSubject}</span>}
                  </div>
                  <StatusBadge status={v.status} />
                </div>
                <ul className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
                  {fs.slice(0, 2).map((f) => (
                    <li key={f.fingerprint} className="flex items-center gap-2"><FileText className="size-4 text-muted-foreground" aria-hidden />{f.filename}</li>
                  ))}
                  {fs.length > 2 && <li><Link href={`/items/${v.id}`} className="text-primary hover:underline">+{fs.length - 2} more</Link></li>}
                </ul>
                <div className="mt-4 flex items-end justify-between gap-4">
                  <div>
                    <div className={cn('flex items-center gap-2 text-sm', due.overdue && 'text-destructive')}><CalendarDays className="size-4" aria-hidden />{due.text}</div>
                    <div className="mt-3 text-xs text-muted-foreground">Case closed {fmtShort(v.caseClosedAt)} · 3-day cleanup policy</div>
                  </div>
                  <EngineerActions itemId={v.id} caseNumber={v.caseNumber} fileCount={fs.length} state={v.state} />
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="flex items-start gap-3 rounded-xl bg-accent px-5 py-4 text-accent-foreground">
        <MessageSquare className="mt-0.5 size-5" aria-hidden />
        <div>
          <div className="text-sm font-semibold">Prefer to stay in Slack?</div>
          <p className="text-[13px] opacity-90">You can acknowledge and confirm directly from your cleanup message. Your record stays in sync here.</p>
        </div>
      </div>
    </>
  );
}
