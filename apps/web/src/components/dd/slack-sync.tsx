'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { SlackSyncResult } from '@dd/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { syncSlack } from '@/lib/actions';
import { cn } from '@/lib/utils';

const ACTION_CLS = { create: 'bg-st-closed-bg text-st-closed', update: 'bg-st-ack-bg text-st-ack', unchanged: 'bg-muted text-muted-foreground' } as const;
const LABEL: Record<string, string> = {
  slackUserId: 'Slack ID', department: 'Department', division: 'Division', organization: 'Organization', costCenter: 'Cost center',
  employeeNumber: 'Employee ID', employeeType: 'Type', location: 'Location', timezone: 'Time zone', title: 'Title', team: 'Team',
};
const FIELD_NAME: Record<string, string> = { managerId: 'Manager', department: 'Department', division: 'Division', organization: 'Organization', costCenter: 'Cost center', employeeNumber: 'Employee ID', userType: 'Employee type' };

export function SlackSync({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [createMissing, setCreateMissing] = useState(true);
  const [result, setResult] = useState<SlackSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const preview = () => start(async () => {
    setError(null);
    const r = await syncSlack(true, createMissing);
    if (!r.ok || !r.data) return setError(r.error ?? 'Could not read Slack');
    setResult(r.data);
  });
  const commit = () => start(async () => {
    const r = await syncSlack(false, createMissing);
    if (!r.ok || !r.data) return setError(r.error ?? 'Sync failed');
    toast.success(`Synced from Slack: ${r.data.created} added, ${r.data.updated} updated, ${r.data.managersLinked} manager link${r.data.managersLinked === 1 ? '' : 's'}`);
    setOpen(false); setResult(null); router.refresh();
  });
  const changed = result ? result.created + result.updated : 0;
  const warnings = result?.issues ?? [];
  return (
    <>
      <Button variant="outline" onClick={() => { setResult(null); setError(null); setOpen(true); }} title={lastSyncedAt ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}` : 'Never synced'}>
        <RefreshCw className="size-4" />Sync from Slack
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setResult(null); }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Sync from Slack</DialogTitle>
            <DialogDescription>Reads every active employee’s profile: manager, department, cost center and more. Review the changes before anything is saved.</DialogDescription>
          </DialogHeader>

          {!result && (
            <div className="space-y-4">
              <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                <Switch checked={createMissing} onCheckedChange={setCreateMissing} aria-label="Add people from Slack" />
                <span><span className="font-medium">Add people from Slack</span><span className="block text-xs text-muted-foreground">People in Slack who are not in the directory yet are added. Needed so managers who are not in your reports still resolve.</span></span>
              </label>
              <p className="text-xs text-muted-foreground">Managers you set by hand or CSV are never overwritten. Only links that came from Slack are refreshed. Reading ~150 profiles takes about 30 seconds.</p>
              {lastSyncedAt && <p className="text-xs text-muted-foreground">Last synced {new Date(lastSyncedAt).toLocaleString()}.</p>}
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-5 gap-3">
                {([['Add', result.created], ['Update', result.updated], ['Unchanged', result.unchanged], ['Manager links', result.managersLinked], ['No manager in Slack', result.withoutManager]] as const).map(([l, n]) => (
                  <div key={l} className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{l}</div><div className="text-2xl font-semibold tabular-nums">{n}</div></div>
                ))}
              </div>
              {result.missingFields.length > 0 && (
                <p className="flex items-start gap-2 rounded-lg bg-st-triage-bg px-3 py-2 text-sm text-st-triage"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />Not defined in your Slack profile, so not synced: {result.missingFields.map((f) => FIELD_NAME[f] ?? f).join(', ')}.</p>
              )}
              {result.managersKeptManual > 0 && <p className="text-xs text-muted-foreground">{result.managersKeptManual} manager{result.managersKeptManual === 1 ? '' : 's'} set by hand differ from Slack and were left as they are.</p>}
              {warnings.length > 0 && (
                <details className="rounded-lg border text-sm">
                  <summary className="cursor-pointer px-3 py-2 font-medium">{warnings.length} to check</summary>
                  <ul className="max-h-32 divide-y overflow-y-auto border-t">{warnings.map((i, k) => <li key={k} className="flex gap-3 px-3 py-1.5 text-xs"><span className="w-52 truncate">{i.email}</span><span className="text-muted-foreground">{i.message}</span></li>)}</ul>
                </details>
              )}
              <div className="max-h-64 overflow-y-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted text-muted-foreground"><tr>{['', 'Person', 'Reports to', 'Changes'].map((h) => <th key={h} className="px-3 py-1.5 text-left font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {result.rows.filter((r) => r.action !== 'unchanged').slice(0, 300).map((r) => (
                      <tr key={r.email} className="border-t align-top">
                        <td className="px-3 py-1.5"><span className={cn('rounded px-1.5 py-0.5 font-medium capitalize', ACTION_CLS[r.action])}>{r.action}</span></td>
                        <td className="px-3 py-1.5"><div className="font-medium">{r.name}</div><div className="text-muted-foreground">{r.email}</div></td>
                        <td className="px-3 py-1.5 text-muted-foreground">{r.manager ?? '—'}{r.managerChange === 'changed' && <span className="ml-1 text-st-ack">(changed)</span>}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{Object.entries(r.changes).filter(([k]) => k !== 'slackSyncedAt').map(([k, [, to]]) => `${LABEL[k] ?? k}: ${to ?? '—'}`).join(' · ') || '—'}</td>
                      </tr>
                    ))}
                    {changed === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">Everything is already up to date.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            {!result && <Button onClick={preview} disabled={pending}>{pending ? 'Reading Slack…' : 'Preview sync'}</Button>}
            {result && <Button onClick={commit} disabled={pending || changed + result.managersLinked === 0}>{pending ? 'Saving…' : `Apply ${changed} change${changed === 1 ? '' : 's'}`}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
