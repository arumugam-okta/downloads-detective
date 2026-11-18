'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { sendTestMessage } from '@/lib/actions';

export function SlackTest({ defaultEmail, mode, disabled = false }: { defaultEmail: string; mode: 'live' | 'dev' | 'unreachable'; disabled?: boolean }) {
  const [email, setEmail] = useState(defaultEmail);
  const [note, setNote] = useState<{ ok: boolean; text: string; link?: string } | null>(null);
  const [pending, start] = useTransition();
  const send = () => start(async () => {
    setNote(null);
    const r = await sendTestMessage(email.trim() || undefined);
    if (!r.ok) { setNote({ ok: false, text: r.error ?? 'Could not send' }); toast.error(r.error ?? 'Could not send'); return; }
    const d = r.data as { ref: string; message: string; itemId: number };
    setNote({ ok: true, text: d.message, link: `/items/${d.itemId}` });
    toast.success(`Test ${d.ref} sent`);
  });
  return (
    <div className="mt-5 border-t pt-5">
      <Label htmlFor="slack-test-email" className="text-sm font-semibold">Send a test message</Label>
      <p className="mt-1 text-xs text-muted-foreground">Creates a labelled test item and DMs it, so you can try the Acknowledge and Confirm buttons. Use the email on the person’s Slack profile.</p>
      <div className="mt-3 flex gap-2">
        <Input id="slack-test-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" aria-describedby="slack-test-note" disabled={mode === 'unreachable' || disabled} />
        <Button onClick={send} disabled={pending || !email.trim() || mode === 'unreachable' || disabled}><Send className="size-4" />{pending ? 'Sending…' : 'Send test'}</Button>
      </div>
      <div id="slack-test-note" aria-live="polite" className="mt-2 min-h-5 text-xs">
        {mode === 'unreachable' && <p className="text-destructive">The Slack service can’t be reached, so there’s nothing to send through.</p>}
        {note && <p className={note.ok ? 'text-st-closed' : 'text-destructive'}>{note.text}{note.link && <> <a href={note.link} className="underline">View item</a></>}</p>}
      </div>
    </div>
  );
}
