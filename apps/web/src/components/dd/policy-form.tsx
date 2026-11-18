'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { savePolicy } from '@/lib/actions';

const SLA = [{ v: 1, l: '1 calendar day' }, { v: 2, l: '2 calendar days' }, { v: 3, l: '3 calendar days' }, { v: 5, l: '5 calendar days' }, { v: 7, l: '7 calendar days' }];
const REMIND = [{ v: '24,48', l: '24 hours and 48 hours' }, { v: '24', l: '24 hours' }, { v: '48', l: '48 hours' }, { v: '', l: 'No reminders' }];
const LEVELS = [{ v: 0, l: 'No escalation' }, { v: 1, l: '1 level: direct manager' }, { v: 2, l: '2 levels: manager, then director' }, { v: 3, l: '3 levels' }, { v: 4, l: '4 levels' }, { v: 5, l: '5 levels' }];
const STEPS = [{ v: 12, l: '12 hours' }, { v: 24, l: '24 hours' }, { v: 48, l: '48 hours' }, { v: 72, l: '72 hours' }];
const ROLE = ['Direct manager', 'Their manager', 'Next level up', 'Next level up', 'Next level up'];

const sel = 'h-9 w-full rounded-lg border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring outline-none';

export function PolicyForm({ initial }: { initial: { slaDays: number; reminderHours: number[]; escalationLevels: number; escalationStepHours: number } }) {
  const router = useRouter();
  const [sla, setSla] = useState(String(initial.slaDays));
  const [rem, setRem] = useState(initial.reminderHours.join(','));
  const [levels, setLevels] = useState(String(initial.escalationLevels));
  const [step, setStep] = useState(String(initial.escalationStepHours));
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    const r = await savePolicy({ slaDays: Number(sla), reminderHours: rem ? rem.split(',').map(Number) : [], escalationLevels: Number(levels), escalationStepHours: Number(step) });
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
        <div className="grid grid-cols-[180px_1fr] items-start gap-4"><Label htmlFor="levels" className="pt-2">Escalation levels</Label><div><select id="levels" className={sel} value={levels} onChange={(e) => setLevels(e.target.value)}>{LEVELS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select><p className="mt-1 text-xs text-muted-foreground">How far up the reporting line an overdue item travels. Level 1 is told at SLA breach.</p></div></div>
        {Number(levels) > 1 && <div className="grid grid-cols-[180px_1fr] items-start gap-4"><Label htmlFor="step" className="pt-2">Time between levels</Label><div><select id="step" className={sel} value={step} onChange={(e) => setStep(e.target.value)}>{STEPS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select><p className="mt-1 text-xs text-muted-foreground">Each level is told this long after the one below it, if the item is still open.</p></div></div>}
        {Number(levels) > 0 && (
          <div className="grid grid-cols-[180px_1fr] items-start gap-4"><span className="pt-0.5 text-sm font-medium">Escalation path</span>
            <ol className="space-y-1.5 text-sm">
              <li className="text-muted-foreground">Due date: engineer is overdue</li>
              {Array.from({ length: Number(levels) }, (_, i) => <li key={i}><span className="font-medium">Level {i + 1} · {ROLE[i]}</span><span className="text-muted-foreground"> · {i === 0 ? 'at breach' : `+${i * Number(step)}h after breach`}</span></li>)}
            </ol>
          </div>
        )}
        <div className="grid grid-cols-[180px_1fr] items-start gap-4"><Label className="pt-2">Accepted evidence</Label><div><div className="flex h-9 items-center rounded-lg border bg-muted px-3 text-sm">Attestation + conditional notes</div><p className="mt-1 text-xs text-muted-foreground">Notes required for approved moves and not-applicable exceptions.</p></div></div>
      </div>
    </div>
  );
}
