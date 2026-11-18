'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { MessageSquare, MessageSquareOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { setSlackEnabled } from '@/lib/actions';
import { cn } from '@/lib/utils';

/** Master switch for everything sent to Slack. Turning it off asks first; turning it on does not. */
export function SlackSwitch({ enabled, pausedAt, held, connected }: { enabled: boolean; pausedAt: string | null; held: number; connected: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const apply = (next: boolean) => start(async () => {
    const r = await setSlackEnabled(next);
    if (!r.ok) return void toast.error(r.error ?? 'Could not change Slack messaging');
    setConfirm(false);
    if (next) toast.success(r.data && (r.data.delivered || r.data.refreshed) ? `Slack messaging is on. Delivered ${r.data.delivered} held item${r.data.delivered === 1 ? '' : 's'}, refreshed ${r.data.refreshed} message${r.data.refreshed === 1 ? '' : 's'}.` : 'Slack messaging is on.');
    else toast.success('Slack messaging is off. Nothing will be sent until you turn it back on.');
    router.refresh();
  });
  return (
    <section className={cn('rounded-xl border p-5', enabled ? 'bg-card' : 'border-st-triage bg-st-triage-bg')}>
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-3">
          {enabled ? <MessageSquare className="mt-0.5 size-5 text-primary" aria-hidden /> : <MessageSquareOff className="mt-0.5 size-5 text-st-triage" aria-hidden />}
          <div>
            <h2 className="text-lg font-semibold">Slack messaging {enabled ? 'is on' : 'is off'}</h2>
            <p className="mt-0.5 max-w-xl text-[13px] text-muted-foreground">
              {enabled
                ? 'New cleanup items, reminders and escalations are sent to Slack as they come due.'
                : `Nothing is being sent: no new items, reminders, escalations or message updates${pausedAt ? ` since ${new Date(pausedAt).toLocaleString()}` : ''}. Deadlines keep running. When you turn it back on, held items are delivered, and anything overdue gets one more escalation interval before a manager is told.`}
            </p>
            {!enabled && held > 0 && <p className="mt-2 text-sm font-medium text-st-triage">{held} item{held === 1 ? ' is' : 's are'} waiting to be delivered.</p>}
            {!connected && <p className="mt-2 text-xs text-muted-foreground">Slack isn’t connected in this environment, so messages are only logged either way.</p>}
          </div>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm font-medium">
          <Switch checked={enabled} disabled={pending} onCheckedChange={(v) => (v ? apply(true) : setConfirm(true))} aria-label="Send messages to Slack" />
          {enabled ? 'On' : 'Off'}
        </label>
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-xl">Turn off Slack messaging?</DialogTitle><DialogDescription>Engineers and managers will stop getting messages straight away.</DialogDescription></DialogHeader>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>New reports still create items, but they’re held without a Slack message.</li>
            <li>Reminders and escalations stop. Due dates keep running.</li>
            <li>Buttons in messages already sent keep working.</li>
            <li>Turning it back on delivers held items. Anything already overdue gets one more escalation interval before a manager is told.</li>
          </ul>
          <DialogFooter><Button variant="outline" onClick={() => setConfirm(false)}>Keep on</Button><Button variant="destructive" disabled={pending} onClick={() => apply(false)}>{pending ? 'Turning off…' : 'Turn off'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
