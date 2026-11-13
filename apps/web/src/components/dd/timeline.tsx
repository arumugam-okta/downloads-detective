import { AlertTriangle, Bell, CalendarClock, CheckCircle2, Clock, Eye, FileUp, MessageSquare, UserCog } from 'lucide-react';
import type { AuditEvent } from '@dd/shared';
import { fmtUtc } from '@/lib/metrics';

const ICON: Record<string, typeof Clock> = {
  case_created: Clock, slack_notified: MessageSquare, reminder_sent: Bell, manual_reminder: Bell, acknowledged: Eye, attested: CheckCircle2,
  manager_notified: AlertTriangle, director_notified: AlertTriangle, escalated: AlertTriangle, reassigned: UserCog, attestation_reviewed: CheckCircle2,
  reopened: Clock, file_added: FileUp, delivery_failed: AlertTriangle, triage_flagged: AlertTriangle,
};
const TITLE: Record<string, string> = {
  case_created: 'Created from daily report', slack_notified: 'Slack message sent', reminder_sent: 'Reminder sent', manual_reminder: 'Reminder sent',
  acknowledged: 'Acknowledged in Slack', attested: 'Attestation submitted', manager_notified: 'SLA missed · manager notified', director_notified: 'Director notified',
  escalated: 'Escalated', reassigned: 'Reassigned', attestation_reviewed: 'Attestation reviewed', reopened: 'Reopened', delivery_failed: 'Slack delivery failed', triage_flagged: 'Needs triage',
};

export function Timeline({ events, due }: { events: AuditEvent[]; due?: { at: string; passed: boolean } }) {
  const rows = events.filter((e) => e.action !== 'file_added');
  return (
    <ol className="space-y-5">
      {rows.map((e) => {
        const Icon = ICON[e.action] ?? Clock;
        const bad = e.action.includes('notified') && e.action !== 'slack_notified' || e.action === 'escalated' || e.action.includes('failed') || e.action === 'triage_flagged';
        return (
          <li key={e.id} className="flex gap-3">
            <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border ${bad ? 'text-destructive' : 'text-muted-foreground'}`}><Icon className="size-3.5" aria-hidden /></span>
            <div>
              <div className="text-sm font-medium">{TITLE[e.action] ?? e.action}</div>
              {e.detail && e.action !== 'case_created' && <div className="text-xs text-muted-foreground">{e.detail}</div>}
              <div className="text-xs text-muted-foreground">{fmtUtc(e.at)}{e.actorLabel !== 'Downloads Detective' ? ` · ${e.actorLabel}` : ''}</div>
            </div>
          </li>
        );
      })}
      {due && !due.passed && (
        <li className="flex gap-3"><span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border text-muted-foreground"><CalendarClock className="size-3.5" aria-hidden /></span>
          <div><div className="text-sm font-medium">Cleanup due</div><div className="text-xs text-muted-foreground">{fmtUtc(due.at)}</div></div></li>
      )}
    </ol>
  );
}
