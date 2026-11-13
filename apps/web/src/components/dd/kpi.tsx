import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Kpi({ label, value, hint, icon: Icon, tone }: { label: string; value: React.ReactNode; hint?: string; icon?: LucideIcon; tone?: 'danger' }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between text-[13px] font-medium text-muted-foreground">
        {label}
        {Icon && <Icon className={cn('size-4', tone === 'danger' && 'text-destructive')} aria-hidden />}
      </div>
      <div className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Note({ title, children, icon }: { title: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-accent px-5 py-4 text-accent-foreground">
      {icon && <div className="mt-0.5">{icon}</div>}
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-0.5 text-[13px] opacity-90">{children}</p>
      </div>
    </div>
  );
}

export function ChartCard({ title, subtitle, children, className, action }: { title: string; subtitle?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={cn('rounded-xl border bg-card p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
