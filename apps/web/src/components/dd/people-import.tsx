'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, FileUp, Upload } from 'lucide-react';
import { PEOPLE_FIELDS, type PeopleCsvInspection, type PeopleImportResult, type PeopleMapping } from '@dd/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { importPeople, inspectPeopleFile } from '@/lib/actions';
import { cn } from '@/lib/utils';

type Step = 'file' | 'map' | 'review';
const ACTION_CLS = { create: 'bg-st-closed-bg text-st-closed', update: 'bg-st-ack-bg text-st-ack', unchanged: 'bg-muted text-muted-foreground' } as const;

export function PeopleImport() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('file');
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<PeopleCsvInspection | null>(null);
  const [mapping, setMapping] = useState<PeopleMapping>({});
  const [result, setResult] = useState<PeopleImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => { setStep('file'); setFile(null); setInfo(null); setMapping({}); setResult(null); setError(null); if (input.current) input.current.value = ''; };
  const form = (f: File) => { const fd = new FormData(); fd.set('file', f); return fd; };

  const pick = (f: File | undefined) => {
    if (!f) return;
    setFile(f); setError(null);
    start(async () => {
      const r = await inspectPeopleFile(form(f));
      if (!r.ok || !r.data) return setError(r.error ?? 'Could not read that file');
      setInfo(r.data); setMapping(r.data.suggested); setStep('map');
    });
  };
  const preview = () => file && start(async () => {
    const r = await importPeople(form(file), mapping, true);
    if (!r.ok || !r.data) return setError(r.error ?? 'Could not validate the file');
    setError(null); setResult(r.data); setStep('review');
  });
  const commit = () => file && start(async () => {
    const r = await importPeople(form(file), mapping, false);
    if (!r.ok || !r.data) return setError(r.error ?? 'Import failed');
    toast.success(`Imported: ${r.data.created} added, ${r.data.updated} updated, ${r.data.managersLinked} manager link${r.data.managersLinked === 1 ? '' : 's'}`);
    setOpen(false); reset(); router.refresh();
  });

  const errors = result?.issues.filter((i) => i.level === 'error') ?? [];
  const warnings = result?.issues.filter((i) => i.level === 'warning') ?? [];
  const nothing = result && result.created + result.updated === 0;
  return (
    <>
      <Button variant="outline" onClick={() => { reset(); setOpen(true); }}><Upload className="size-4" />Import CSV</Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Import people</DialogTitle>
            <DialogDescription>{step === 'file' ? 'Upload a CSV from your HR system or directory.' : step === 'map' ? `Match your columns to Downloads Detective fields. ${info?.total ?? 0} rows found.` : 'Review what will change. Nothing is saved until you import.'}</DialogDescription>
          </DialogHeader>
          <ol className="flex gap-4 text-xs text-muted-foreground" aria-label="Progress">
            {(['file', 'map', 'review'] as const).map((s, i) => <li key={s} className={cn(step === s && 'font-semibold text-foreground')}>{i + 1}. {{ file: 'Upload', map: 'Map columns', review: 'Review' }[s]}</li>)}
          </ol>

          {step === 'file' && (
            <button type="button" onClick={() => input.current?.click()} disabled={pending} className="grid place-items-center gap-2 rounded-xl border-2 border-dashed px-6 py-14 text-center hover:bg-accent/40">
              <FileUp className="size-8 text-muted-foreground" aria-hidden />
              <span className="font-medium">{pending ? 'Reading…' : 'Choose a CSV file'}</span>
              <span className="max-w-md text-xs text-muted-foreground">Needs an email column. Name, title, team, manager email, roles and Slack ID are optional. Re-importing is safe: people are matched by email.</span>
            </button>
          )}
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label="People CSV" onChange={(e) => pick(e.target.files?.[0])} />

          {step === 'map' && info && (
            <div className="max-h-[52vh] overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground"><tr><th className="px-4 py-2 text-left font-medium">Field</th><th className="px-4 py-2 text-left font-medium">Column in your file</th><th className="px-4 py-2 text-left font-medium">First row</th></tr></thead>
                <tbody>
                  {PEOPLE_FIELDS.map((f) => {
                    const col = mapping[f.key];
                    return (
                      <tr key={f.key} className="border-t">
                        <td className="px-4 py-2"><div className="font-medium">{f.label}{f.required && <span className="text-destructive"> *</span>}</div>{f.hint && <div className="text-xs text-muted-foreground">{f.hint}</div>}</td>
                        <td className="px-4">
                          <select aria-label={`Column for ${f.label}`} value={col ?? ''} onChange={(e) => setMapping((m) => { const n = { ...m }; if (e.target.value) n[f.key] = e.target.value; else delete n[f.key]; return n; })} className="h-8 w-full rounded-lg border bg-background px-2 text-sm">
                            <option value="">{f.required ? 'Choose a column…' : 'Not mapped'}</option>
                            {info.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                          </select>
                        </td>
                        <td className="max-w-48 truncate px-4 text-muted-foreground">{col ? info.sample[0]?.[col] || '—' : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {step === 'review' && result && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-3">
                {([['Add', result.created], ['Update', result.updated], ['Unchanged', result.unchanged], ['Manager links', result.managersLinked]] as const).map(([l, n]) => (
                  <div key={l} className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{l}</div><div className="text-2xl font-semibold tabular-nums">{n}</div></div>
                ))}
              </div>
              {result.blocking && <p role="alert" className="flex items-center gap-2 rounded-lg bg-st-overdue-bg px-3 py-2 text-sm text-st-overdue"><AlertTriangle className="size-4" aria-hidden />{result.blocking}</p>}
              {result.issues.length > 0 && (
                <details className="rounded-lg border text-sm" open={errors.length > 0}>
                  <summary className="cursor-pointer px-3 py-2 font-medium">{errors.length} skipped · {warnings.length} to check</summary>
                  <ul className="max-h-36 divide-y overflow-y-auto border-t">
                    {result.issues.map((i, k) => <li key={k} className="flex gap-3 px-3 py-1.5 text-xs"><span className="w-12 text-muted-foreground">Row {i.rowNo}</span><span className="w-48 truncate">{i.email}</span><span className={i.level === 'error' ? 'text-destructive' : 'text-muted-foreground'}>{i.message}</span></li>)}
                  </ul>
                </details>
              )}
              <div className="max-h-56 overflow-y-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted text-muted-foreground"><tr>{['', 'Name', 'Email', 'Reports to'].map((h) => <th key={h} className="px-3 py-1.5 text-left font-medium">{h}</th>)}</tr></thead>
                  <tbody>{result.rows.slice(0, 200).map((r) => (
                    <tr key={r.email} className="border-t"><td className="px-3 py-1.5"><span className={cn('rounded px-1.5 py-0.5 font-medium capitalize', ACTION_CLS[r.action])}>{r.action}</span></td><td className="px-3">{r.name}</td><td className="px-3 text-muted-foreground">{r.email}</td><td className="px-3 text-muted-foreground">{r.manager ?? '—'}</td></tr>
                  ))}</tbody>
                </table>
                {result.rows.length > 200 && <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">Showing the first 200 of {result.rows.length}.</p>}
              </div>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="sm:justify-between">
            <div>{step !== 'file' && <Button variant="ghost" onClick={() => { setError(null); setStep(step === 'review' ? 'map' : 'file'); if (step === 'map') reset(); }}><ArrowLeft className="size-4" />Back</Button>}</div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              {step === 'map' && <Button onClick={preview} disabled={pending || !mapping.email}>{pending ? 'Checking…' : 'Preview import'}</Button>}
              {step === 'review' && <Button onClick={commit} disabled={pending || !!result?.blocking || !!nothing}>{pending ? 'Importing…' : nothing ? 'Nothing to import' : `Import ${result ? result.created + result.updated : 0} people`}</Button>}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
