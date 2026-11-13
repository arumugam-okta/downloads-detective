'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { savePolicy } from '@/lib/actions';

const SLA = [{ v: 1, l: '1 calendar day' }, { v: 2, l: '2 calendar days' }, { v: 3, l: '3 calendar days' }, { v: 5, l: '5 calendar days' }, { v: 7, l: '7 calendar days' }];
const REMIND = [{ v: '24,48', l: '24 hours and 48 hours' }, { v: '24', l: '24 hours' }, { v: '48', l: '48 hours' }, { v: '', l: 'No reminders' }];
const DIRECTOR = [{ v: 24, l: 'Another 24 hours' }, { v: 48, l: 'Another 48 hours' }, { v: 72, l: 'Another 72 hours' }];

const sel = 'h-9 w-full rounded-lg border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring outline-none';

export function PolicyForm({ initial }: { initial: { slaDays: number; reminderHours: number[]; directorAfterBreachHours: number } }) {
  const router = useRouter();
  const [sla, setSla] = useState(String(initial.slaDays));
  const [rem, setRem] = useState(initial.reminderHours.join(','));
  const [dir, setDir] = useState(String(initial.directorAfterBreachHours));
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    const r = await savePolicy({ slaDays: Number(sla), reminderHours: rem ? rem.split(',').map(Number) : [], directorAfterBreachHours: Number(dir) });
    if (r.ok) { toast.success('Policy saved. Existing due dates are unchanged.'); router.refresh(); } else toast.error(r.error ?? 'Could not save');
  });
  return (
    <div>
      <div className="flex items-start justify-between">
        <div><h2 className="text-lg font-semibold">Cleanup policy</h2><p className="text-[13px] text-muted-foreground">Applies when a Salesforce case is closed.</p></div>
        <Button onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</Button>
      </div>
      <div className="mt-6 space-y-6">
        <div className="grid grid-cols-[180px_1fr] items-start gap-4"><Label htmlFor="sla" className="pt-2">Cleanup SLA</Label><div><select id="sla" className={sel} value={sla} onChange={(e) => setSla(e.target.value)}>{SLA.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select><p className="mt-1 text-xs text-muted-foreground">Starts at case closure, not download time.</p></div></div>
        <div className="grid grid-cols-[180px_1fr] items-start gap-4"><Label htmlFor="rem" className="pt-2">Reminder cadence</Label><div><select id="rem" className={sel} value={rem} onChange={(e) => setRem(e.target.value)}>{REMIND.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select><p className="mt-1 text-xs text-muted-foreground">Stop reminders immediately after attestation.</p></div></div>
        <div className="grid grid-cols-[180px_1fr] items-start gap-4"><Label htmlFor="dir" className="pt-2">Escalation route</Label><div><select id="dir" className={sel} value={dir} onChange={(e) => setDir(e.target.value)}>{DIRECTOR.map((o) => <option key={o.v} value={o.v}>Direct manager → Director · {o.l.toLowerCase()}</option>)}</select><p className="mt-1 text-xs text-muted-foreground">Notify manager at SLA breach; director after the delay.</p></div></div>
        <div className="grid grid-cols-[180px_1fr] items-start gap-4"><Label className="pt-2">Accepted evidence</Label><div><div className="flex h-9 items-center rounded-lg border bg-muted px-3 text-sm">Attestation + conditional notes</div><p className="mt-1 text-xs text-muted-foreground">Notes required for approved moves and not-applicable exceptions.</p></div></div>
      </div>
    </div>
  );
}
