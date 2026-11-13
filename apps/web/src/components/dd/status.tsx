import { AlertTriangle, CheckCircle2, Clock, Eye, Hourglass, XCircle } from 'lucide-react';
import type { DisplayStatus } from '@dd/shared';
import { cn } from '@/lib/utils';

export const STATUS_META: Record<DisplayStatus | 'pending_review', { label: string; icon: typeof Clock; cls: string }> = {
  open: { label: 'Open', icon: Clock, cls: 'bg-st-open-bg text-st-open' },
  acknowledged: { label: 'Acknowledged', icon: Eye, cls: 'bg-st-ack-bg text-st-ack' },
  closed: { label: 'Closed', icon: CheckCircle2, cls: 'bg-st-closed-bg text-st-closed' },
  overdue: { label: 'Overdue', icon: AlertTriangle, cls: 'bg-st-overdue-bg text-st-overdue' },
  triage: { label: 'Needs triage', icon: AlertTriangle, cls: 'bg-st-triage-bg text-st-triage' },
  failed: { label: 'Failed', icon: XCircle, cls: 'border border-st-failed bg-st-failed-bg text-st-failed' },
  pending_review: { label: 'Pending review', icon: Hourglass, cls: 'bg-[#f1ecfb] text-[#5b3ea8] dark:bg-[#251d3a] dark:text-[#b9a4f0]' },
};

/** Status is always icon + label, never colour alone. */
export function StatusBadge({ status, className }: { status: keyof typeof STATUS_META; className?: string }) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap', m.cls, className)}>
      <Icon className="size-3.5" aria-hidden />
      {m.label}
    </span>
  );
}
