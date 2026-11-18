'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, RefreshCw, Search } from 'lucide-react';
import { SLACK_TARGETS, type SlackDirectoryView, type SlackMapping, type SlackProfile, type SlackSyncResult } from '@dd/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { readSlackDirectory, syncSlack } from '@/lib/actions';
import { cn } from '@/lib/utils';

type Step = 'pick' | 'map' | 'review';
const ACTION_CLS = { create: 'bg-st-closed-bg text-st-closed', update: 'bg-st-ack-bg text-st-ack', unchanged: 'bg-muted text-muted-foreground' } as const;
const TARGET_LABEL = Object.fromEntries(SLACK_TARGETS.map((t) => [t.key, t.label]));
const PAGE = 100;

export interface KnownPerson { email: string; slackUserId: string | null }

export function SlackSync({ lastSyncedAt, known }: { lastSyncedAt: string | null; known: KnownPerson[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('pick');
  const [dir, setDir] = useState<SlackDirectoryView | null>(null);
  const [mapping, setMapping] = useState<SlackMapping>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [withChain, setWithChain] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [result, setResult] = useState<SlackSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => { setStep('pick'); setDir(null); setMapping({}); setSelected(new Set()); setQ(''); setDept(''); setOnlyNew(false); setLimit(PAGE); setResult(null); setError(null); };
  const load = () => start(async () => {
    setError(null);
    const r = await readSlackDirectory();
    if (!r.ok || !r.data) return setError(r.error ?? 'Could not read Slack');
    setDir(r.data); setMapping(r.data.suggested);
  });

  const fieldKey = (t: keyof SlackMapping) => mapping[t];
  const v = (p: SlackProfile, t: keyof SlackMapping) => { const k = fieldKey(t); return (k && p.values[k]) || ''; };
  const deptKey = dir?.suggested.department ?? dir?.suggested.team;
  const inDb = useMemo(() => new Set(known.flatMap((k) => [k.email, ...(k.slackUserId ? [k.slackUserId] : [])])), [known]);
  const people = useMemo(() => (dir?.people ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)), [dir]);
  const departments = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of people) { const d = deptKey ? p.values[deptKey] : undefined; if (d) m.set(d, (m.get(d) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [people, deptKey]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return people.filter((p) => (!n || `${p.name} ${p.email} ${p.values.title ?? ''}`.toLowerCase().includes(n))
      && (!dept || (deptKey ? p.values[deptKey] : '') === dept)
      && (!onlyNew || !(inDb.has(p.email) || inDb.has(p.slackUserId))));
  }, [people, q, dept, onlyNew, inDb, deptKey]);
  const allShownSelected = shown.length > 0 && shown.every((p) => selected.has(p.slackUserId));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleShown = () => setSelected((s) => { const n = new Set(s); for (const p of shown) { if (allShownSelected) n.delete(p.slackUserId); else n.add(p.slackUserId); } return n; });
  const nameOf = (id: string | undefined) => (id ? people.find((p) => p.slackUserId === id)?.name : undefined);

  const request = (dryRun: boolean) => ({ snapshotId: dir!.snapshotId, mapping, selected: [...selected], withChain, overwrite, dryRun });
  const preview = () => start(async () => {
    setError(null);
    const r = await syncSlack(request(true));
    if (!r.ok || !r.data) return setError(r.error ?? 'Could not build the preview');
    setResult(r.data); setStep('review');
  });
  const commit = () => start(async () => {
    const r = await syncSlack(request(false));
    if (!r.ok || !r.data) return setError(r.error ?? 'Import failed');
    toast.success(`Imported from Slack: ${r.data.created} added, ${r.data.updated} updated, ${r.data.managersLinked} manager link${r.data.managersLinked === 1 ? '' : 's'}`);
    setOpen(false); reset(); router.refresh();
  });

  const changed = result ? result.created + result.updated : 0;
  const sample = people.find((p) => selected.has(p.slackUserId)) ?? people[0];
  const stepTitle = { pick: 'Choose people', map: 'Map fields', review: 'Review' }[step];
  return (
    <>
      <Button variant="outline" onClick={() => { reset(); setOpen(true); load(); }} title={lastSyncedAt ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}` : 'Never synced'}>
        <RefreshCw className="size-4" />Sync from Slack
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Import from Slack</DialogTitle>
            <DialogDescription>{step === 'pick' ? 'Choose who to import. Nothing is saved until you review it.' : step === 'map' ? 'Choose which Slack profile field feeds each detail.' : 'Check what will change. Nothing is saved until you apply.'}</DialogDescription>
          </DialogHeader>
          <ol className="flex gap-4 text-xs text-muted-foreground" aria-label="Progress">
            {(['pick', 'map', 'review'] as const).map((s, i) => <li key={s} className={cn(step === s && 'font-semibold text-foreground')}>{i + 1}. {{ pick: 'Choose people', map: 'Map fields', review: 'Review' }[s]}</li>)}
          </ol>

          {step === 'pick' && (
            <div className="space-y-3">
              {!dir && !error && <p className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground" role="status">Reading profiles from Slack. This takes about 40 seconds.</p>}
              {dir && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-64"><Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden /><Input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Search name, email, title…" className="pl-8" aria-label="Search people" /></div>
                    <select aria-label="Department" value={dept} onChange={(e) => { setDept(e.target.value); setLimit(PAGE); }} className="h-9 max-w-64 rounded-lg border bg-background px-2 text-sm">
                      <option value="">All departments ({people.length})</option>
                      {departments.map(([d, n]) => <option key={d} value={d}>{d} ({n})</option>)}
                    </select>
                    <label className="flex items-center gap-2 text-sm"><Switch checked={onlyNew} onCheckedChange={setOnlyNew} aria-label="Only people not yet imported" />Not imported yet</label>
                    <span className="ml-auto text-sm text-muted-foreground">{selected.size} selected</span>
                  </div>
                  <div className="max-h-[48vh] overflow-y-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                        <tr>
                          <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Select everyone shown" checked={allShownSelected} onChange={toggleShown} className="size-4 accent-[var(--primary)]" /></th>
                          {['Person', 'Title', 'Department', 'Manager'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {shown.slice(0, limit).map((p) => {
                          const imported = inDb.has(p.email) || inDb.has(p.slackUserId);
                          return (
                            <tr key={p.slackUserId} className="cursor-pointer border-t hover:bg-accent/40" onClick={() => toggle(p.slackUserId)}>
                              <td className="px-3 py-1.5"><input type="checkbox" aria-label={`Select ${p.name}`} checked={selected.has(p.slackUserId)} onChange={() => toggle(p.slackUserId)} onClick={(e) => e.stopPropagation()} className="size-4 accent-[var(--primary)]" /></td>
                              <td className="px-3"><div className="font-medium">{p.name}{imported && <span className="ml-1.5 rounded bg-muted px-1.5 text-[11px] font-normal text-muted-foreground">in directory</span>}</div><div className="text-xs text-muted-foreground">{p.email}</div></td>
                              <td className="px-3 text-muted-foreground">{p.values.title ?? '—'}</td>
                              <td className="px-3 text-muted-foreground">{deptKey ? p.values[deptKey] ?? '—' : '—'}</td>
                              <td className="px-3 text-muted-foreground">{nameOf(v(p, 'manager')) ?? '—'}</td>
                            </tr>
                          );
                        })}
                        {shown.length === 0 && <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">No one matches. Try clearing the search or filters.</td></tr>}
                      </tbody>
                    </table>
                    {shown.length > limit && <div className="border-t p-2 text-center"><Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, shown.length - limit)} more ({shown.length - limit} left)</Button></div>}
                  </div>
                  <p className="text-xs text-muted-foreground">Showing {Math.min(limit, shown.length)} of {shown.length} matching · {people.length} read from Slack{dir.failed ? ` · ${dir.failed} could not be read` : ''}.</p>
                </>
              )}
            </div>
          )}

          {step === 'map' && dir && (
            <div className="space-y-3">
              <div className="max-h-[44vh] overflow-y-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted text-xs text-muted-foreground"><tr>{['Detail', 'Slack profile field', 'Example'].map((h) => <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {SLACK_TARGETS.map((t) => {
                      const key = mapping[t.key];
                      const ex = key && sample ? sample.values[key] : undefined;
                      const exShown = t.key === 'manager' ? nameOf(ex) ?? ex : ex;
                      return (
                        <tr key={t.key} className="border-t">
                          <td className="px-4 py-2"><div className="font-medium">{t.label}</div>{t.hint && <div className="text-xs text-muted-foreground">{t.hint}</div>}</td>
                          <td className="px-4">
                            <select aria-label={`Slack field for ${t.label}`} value={key ?? ''} onChange={(e) => setMapping((m) => { const n = { ...m }; if (e.target.value) n[t.key] = e.target.value; else delete n[t.key]; return n; })} className="h-8 w-full rounded-lg border bg-background px-2 text-sm">
                              <option value="">Don’t import</option>
                              {dir.fields.filter((f) => t.key !== 'manager' || f.type === 'user').map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </select>
                          </td>
                          <td className="max-w-56 truncate px-4 text-muted-foreground">{exShown ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                <Switch checked={withChain} onCheckedChange={setWithChain} aria-label="Include their managers" disabled={!mapping.manager} />
                <span><span className="font-medium">Include their managers</span><span className="block text-xs text-muted-foreground">Also imports each selected person’s manager, and theirs, up the chain, so escalations have somewhere to go. Turn off to import only the people you ticked.</span></span>
              </label>
              <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                <Switch checked={overwrite} onCheckedChange={setOverwrite} aria-label="Replace existing title and team" />
                <span><span className="font-medium">Replace existing title and team</span><span className="block text-xs text-muted-foreground">Off: Slack only fills them in when they’re empty. Managers set by hand or CSV are never overwritten either way.</span></span>
              </label>
            </div>
          )}

          {step === 'review' && result && (
            <div className="space-y-3">
              <div className="grid grid-cols-5 gap-3">
                {([['Add', result.created], ['Update', result.updated], ['Unchanged', result.unchanged], ['Manager links', result.managersLinked], ['Managers added', result.chainAdded]] as const).map(([l, n]) => (
                  <div key={l} className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{l}</div><div className="text-2xl font-semibold tabular-nums">{n}</div></div>
                ))}
              </div>
              {result.emptyTargets.length > 0 && <p className="flex items-start gap-2 rounded-lg bg-st-triage-bg px-3 py-2 text-sm text-st-triage"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />Nobody you selected has a value for {result.emptyTargets.map((t) => TARGET_LABEL[t]).join(', ')}, so nothing will be saved for {result.emptyTargets.length === 1 ? 'it' : 'them'}.</p>}
              {result.managersKeptManual > 0 && <p className="text-xs text-muted-foreground">{result.managersKeptManual} manager{result.managersKeptManual === 1 ? '' : 's'} set by hand differ from Slack and were left as they are.</p>}
              {result.issues.length > 0 && (
                <details className="rounded-lg border text-sm"><summary className="cursor-pointer px-3 py-2 font-medium">{result.issues.length} to check</summary>
                  <ul className="max-h-28 divide-y overflow-y-auto border-t">{result.issues.map((i, k) => <li key={k} className="flex gap-3 px-3 py-1.5 text-xs"><span className="w-52 shrink-0 truncate">{i.email}</span><span className="text-muted-foreground">{i.message}</span></li>)}</ul></details>
              )}
              <div className="max-h-[36vh] overflow-y-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted text-muted-foreground"><tr>{['', 'Person', 'Reports to', 'Changes'].map((h) => <th key={h} className="px-3 py-1.5 text-left font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {result.rows.filter((r) => r.action !== 'unchanged').slice(0, 300).map((r) => (
                      <tr key={r.email} className="border-t align-top">
                        <td className="px-3 py-1.5"><span className={cn('rounded px-1.5 py-0.5 font-medium capitalize', ACTION_CLS[r.action])}>{r.action}</span></td>
                        <td className="px-3 py-1.5"><div className="font-medium">{r.name}{r.viaChain && <span className="ml-1.5 font-normal text-muted-foreground">(manager)</span>}</div><div className="text-muted-foreground">{r.email}</div></td>
                        <td className="px-3 py-1.5 text-muted-foreground">{r.manager ?? '—'}{r.managerChange === 'changed' && <span className="ml-1 text-st-ack">(changed)</span>}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{Object.entries(r.changes).filter(([k]) => k !== 'slackUserId').map(([k, [, to]]) => `${TARGET_LABEL[k] ?? k}: ${to ?? '—'}`).join(' · ') || '—'}</td>
                      </tr>
                    ))}
                    {changed === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">Everything you selected is already up to date.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="sm:justify-between">
            <div>
              {step !== 'pick' && <Button variant="ghost" onClick={() => { setError(null); setStep(step === 'review' ? 'map' : 'pick'); }}><ArrowLeft className="size-4" />Back</Button>}
              {step === 'pick' && error && <Button variant="outline" onClick={load} disabled={pending}>Try again</Button>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              {step === 'pick' && <Button onClick={() => setStep('map')} disabled={!dir || selected.size === 0}>Next: map fields{selected.size ? ` (${selected.size})` : ''}</Button>}
              {step === 'map' && <Button onClick={preview} disabled={pending}>{pending ? 'Checking…' : 'Preview import'}</Button>}
              {step === 'review' && <Button onClick={commit} disabled={pending || changed + (result?.managersLinked ?? 0) === 0}>{pending ? 'Saving…' : `Apply ${changed} change${changed === 1 ? '' : 's'}`}</Button>}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
