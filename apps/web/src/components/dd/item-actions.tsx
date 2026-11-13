'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { acknowledgeItem, attestItem, escalateItem, mapSlackUser, reassignItem, remindItem, retryAllFailed, retryItem, reviewItem, type ActionResult } from '@/lib/actions';
import { cn } from '@/lib/utils';

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); router.refresh(); } else toast.error(r.error ?? 'Something went wrong');
    });
  return { pending, run };
}

const KINDS = [
  { value: 'deleted', label: 'Deleted all local copies' },
  { value: 'approved_location', label: 'Moved to approved location' },
  { value: 'not_applicable', label: 'Not applicable' },
] as const;

export function ConfirmDialog({ itemId, caseNumber, fileCount, open, onOpenChange }: { itemId: number; caseNumber: string; fileCount: number; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<string>('deleted');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const needsNotes = kind !== 'deleted';
  const submit = () => {
    if (needsNotes && !notes.trim()) return setError('Notes are required for “Moved” or “Not applicable”.');
    setError(null);
    start(async () => {
      const r = await attestItem(itemId, kind, notes);
      if (r.ok) { onOpenChange(false); toast.success('Thanks. Your confirmation is on the record.'); router.refresh(); } else setError(r.error ?? 'Could not save');
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Confirm action taken</DialogTitle>
          <DialogDescription>Case #{caseNumber} · {fileCount} downloaded file{fileCount === 1 ? '' : 's'}</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">What did you do with the files?</legend>
          {KINDS.map((k) => (
            <label key={k.value} className={cn('flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 text-sm', kind === k.value && 'border-primary bg-accent')}>
              <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => { setKind(k.value); setError(null); }} className="size-4 accent-[var(--primary)]" />
              {k.label}
            </label>
          ))}
        </fieldset>
        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes {needsNotes ? '' : '(optional for deletion)'}</Label>
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add context for the compliance record…" rows={3} aria-invalid={!!error} />
          <p className="text-xs text-muted-foreground">Notes are required for “Moved” or “Not applicable”.</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <p className="text-xs text-muted-foreground">Submitting records your identity and the current time.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>{pending ? 'Saving…' : 'Submit'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EngineerActions({ itemId, caseNumber, fileCount, state, size = 'default' }: { itemId: number; caseNumber: string; fileCount: number; state: string; size?: 'default' | 'sm' }) {
  const { pending, run } = useAct();
  const [open, setOpen] = useState(false);
  if (state === 'closed') return null;
  return (
    <div className="flex items-center gap-3">
      {state === 'open' && <Button variant="outline" size={size} disabled={pending} onClick={() => run(() => acknowledgeItem(itemId), 'Acknowledged')}>Acknowledge</Button>}
      <Button size={size} disabled={pending} onClick={() => setOpen(true)}>Confirm action taken</Button>
      <ConfirmDialog itemId={itemId} caseNumber={caseNumber} fileCount={fileCount} open={open} onOpenChange={setOpen} />
    </div>
  );
}

export function ManagerActions({ itemId, state, hasAttestation, reviewed, reassignOptions, canEscalate = true }: {
  itemId: number; state: string; hasAttestation: boolean; reviewed: boolean; reassignOptions: Array<{ id: number; name: string }>; canEscalate?: boolean;
}) {
  const { pending, run } = useAct();
  const [reassign, setReassign] = useState(false);
  const [to, setTo] = useState('');
  const closed = state === 'closed';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {!closed && <Button variant="outline" disabled={pending} onClick={() => run(() => remindItem(itemId), 'Reminder sent in Slack')}>Send reminder</Button>}
        {!closed && canEscalate && <Button disabled={pending} onClick={() => run(() => escalateItem(itemId), 'Escalation sent')}>Escalate</Button>}
        {!closed && reassignOptions.length > 0 && <Button variant="outline" disabled={pending} onClick={() => setReassign((v) => !v)}>Reassign</Button>}
        {closed && hasAttestation && <Button variant="outline" disabled={pending || reviewed} onClick={() => run(() => reviewItem(itemId), 'Marked reviewed')}>{reviewed ? 'Reviewed' : 'Mark reviewed'}</Button>}
      </div>
      {reassign && (
        <div className="flex items-center gap-2">
          <select aria-label="Reassign to" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 rounded-lg border bg-background px-2 text-sm">
            <option value="">Choose a person…</option>
            {reassignOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <Button size="sm" disabled={!to || pending} onClick={() => run(() => reassignItem(itemId, Number(to)), 'Reassigned')}>Confirm</Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Actions are recorded in the audit log.</p>
    </div>
  );
}

export function RetryButtons({ itemId, personId, canMap }: { itemId: number; personId: number; canMap: boolean }) {
  const { pending, run } = useAct();
  return canMap
    ? <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => mapSlackUser(personId), 'Mapped and delivered')}>Map user</Button>
    : <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => retryItem(itemId), 'Retried')}>Retry</Button>;
}

export function RetryAll({ count }: { count: number }) {
  const { pending, run } = useAct();
  return <Button disabled={pending || count === 0} onClick={() => run(() => retryAllFailed(), 'Retry finished')}>Retry {count} failed</Button>;
}
