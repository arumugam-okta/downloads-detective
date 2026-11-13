import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FileText, ShieldCheck } from 'lucide-react';
import { ATTESTATION_LABEL, managerChain, isOpenState } from '@dd/shared';
import { PageHeader } from '@/components/dd/kpi';
import { StatusBadge } from '@/components/dd/status';
import { EngineerActions, ManagerActions } from '@/components/dd/item-actions';
import { Timeline } from '@/components/dd/timeline';
import { canSee, getSession, getStore } from '@/lib/session';
import { fmtDate, humanDue, toViews, fmtUtc } from '@/lib/metrics';

export default async function ItemDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  const { now, items, files, people } = s.world;
  const item = items.find((i) => i.id === Number(id));
  if (!item || !canSee(s, item.engineerId)) notFound();
  const [v] = toViews([item], people, files, now);
  if (!v) notFound();

  const store = await getStore();
  const { events } = await store.listAudit({ itemId: item.id, limit: 100, offset: 0 });
  const fs = files.filter((f) => f.itemId === item.id);
  const chain = managerChain(people, item.engineerId);
  const manager = chain[0];
  const isMine = s.viewer.person.id === item.engineerId;
  const isManagerOfItem = chain.some((m) => m.id === s.viewer.person.id) || s.viewer.person.isCompliance;
  const due = humanDue(item.dueAt, now, item.state);
  const backHref = isMine ? '/cleanup' : s.role === 'compliance' ? '/items' : '/items';
  const reassignOptions = isManagerOfItem && item.state !== 'closed'
    ? people.filter((p) => p.active && p.id !== item.engineerId && p.managerId === (manager?.id ?? -1)).map((p) => ({ id: p.id, name: p.name }))
    : [];

  return (
    <>
      <nav className="text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href={backHref} className="hover:underline">{isMine ? 'My cleanup' : 'Items'}</Link> <span className="mx-1">/</span> <span className="text-foreground">Case #{item.caseNumber}</span>
      </nav>
      <PageHeader title={`Case #${item.caseNumber}`} subtitle={item.caseSubject ?? undefined} actions={<StatusBadge status={v.status} />} />

      <section className="grid grid-cols-4 gap-4 rounded-xl border bg-card p-5" aria-label="Summary">
        {[
          ['Engineer', v.engineer.name], ['Manager', manager?.name ?? '—'], ['Case closed', fmtDate(item.caseClosedAt)],
          ['Cleanup due', item.state === 'closed' ? fmtDate(item.dueAt) : due.text],
        ].map(([k, val]) => (
          <div key={k}><div className="text-xs text-muted-foreground">{k}</div><div className="mt-1 text-sm font-medium">{val}</div></div>
        ))}
      </section>

      {item.error && <p role="alert" className="rounded-xl border border-st-failed bg-card px-4 py-3 text-sm text-st-failed">{item.state === 'triage' ? 'Needs triage' : 'Delivery failed'}: {item.error}</p>}

      <div className="grid grid-cols-[1fr_340px] gap-4">
        <div className="space-y-4">
          <section className="rounded-xl border bg-card p-5">
            <h2 className="text-base font-semibold">Downloaded files</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{fs.length} file{fs.length === 1 ? '' : 's'}{fs[0] ? ` · Downloaded ${fmtDate(fs[0].downloadedOn).replace(/, \d{4}/, '')}` : ''}</p>
            <ul className="mt-3 divide-y">
              {fs.map((f) => (
                <li key={f.fingerprint} className="flex items-center gap-3 py-3 text-sm">
                  <FileText className="size-4 text-muted-foreground" aria-hidden />
                  <div><div>{f.filename}</div><div className="text-xs text-muted-foreground">Salesforce case attachment · {fmtUtc(f.downloadedOn)}</div></div>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border bg-card p-5">
            <div className="flex items-center gap-2"><ShieldCheck className="size-5" aria-hidden /><h2 className="text-base font-semibold">{item.state === 'closed' ? 'Attestation' : isMine ? 'Awaiting your confirmation' : 'No attestation yet'}</h2></div>
            {item.state === 'closed' && item.attestationKind ? (
              <div className="mt-3 space-y-1 text-sm">
                <p className="font-medium">{ATTESTATION_LABEL[item.attestationKind]}.</p>
                {item.attestationNotes && <p className="text-muted-foreground">{item.attestationNotes}</p>}
                <p className="text-xs text-muted-foreground">Attested {item.attestedAt && fmtUtc(item.attestedAt)} by {v.engineer.name}{item.reviewedAt ? ` · reviewed ${fmtUtc(item.reviewedAt)}` : ''}</p>
              </div>
            ) : isMine ? (
              <p className="mt-3 text-sm text-muted-foreground">Confirm what happened to every downloaded file. Your attestation becomes part of the permanent audit record.</p>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Item remains {v.status === 'overdue' ? 'overdue' : 'open'} until the engineer confirms cleanup.</p>
            )}
            <p className="mt-6 text-xs text-muted-foreground">Submitted attestations are timestamped and cannot be silently edited.</p>
          </section>
        </div>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="text-base font-semibold">Activity timeline</h2>
          <div className="mt-4"><Timeline events={[...events].reverse()} due={isOpenState(item.state) ? { at: item.dueAt, passed: new Date(item.dueAt) < now } : undefined} /></div>
          <p className="mt-6 text-xs text-muted-foreground">All times shown in UTC</p>
        </section>
      </div>

      <div>
        {isMine && item.state !== 'closed' && <EngineerActions itemId={item.id} caseNumber={item.caseNumber} fileCount={fs.length} state={item.state} />}
        {!isMine && isManagerOfItem && (
          <ManagerActions itemId={item.id} state={item.state} hasAttestation={!!item.attestationKind} reviewed={!!item.reviewedAt} reassignOptions={reassignOptions} />
        )}
      </div>
    </>
  );
}
