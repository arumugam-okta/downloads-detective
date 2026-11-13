'use client';

import { useMemo, useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface TeamRow {
  id: number; name: string; email: string; open: number; overdue: number; closed: number; sla: number | null; last: string; lastAt: string;
}
type SortKey = 'open' | 'overdue' | 'closed' | 'sla';

export function TeamTable({ rows, reassignable: _r }: { rows: TeamRow[]; reassignable: Array<{ id: number; name: string }> }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const sorted = useMemo(() => (sort ? [...rows].sort((a, b) => ((a[sort.key] ?? -1) - (b[sort.key] ?? -1)) * sort.dir) : rows), [rows, sort]);
  const th = (key: SortKey, label: string) => (
    <th className="px-3 py-2 text-left font-medium">
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => (s?.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }))} aria-label={`Sort by ${label}`}>
        {label}<ArrowUpDown className="size-3" aria-hidden />
      </button>
    </th>
  );
  const active = rows.find((r) => r.id === openId);
  return (
    <>
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr><th className="px-5 py-2 text-left font-medium">Engineer</th>{th('open', 'Open')}{th('overdue', 'Overdue')}{th('closed', 'Closed')}{th('sla', 'SLA')}<th className="px-3 py-2 text-left font-medium">Last activity</th></tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className="cursor-pointer border-t hover:bg-accent/50" onClick={() => setOpenId(r.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(r.id)}>
              <td className="px-5 py-2.5"><div className="flex items-center gap-3"><Avatar className="size-8"><AvatarFallback>{r.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</AvatarFallback></Avatar><div><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.email}</div></div></div></td>
              <td className="px-3 tabular-nums">{r.open}</td>
              <td className={cn('px-3 tabular-nums', r.overdue > 0 && 'text-destructive')}>{r.overdue}</td>
              <td className="px-3 tabular-nums">{r.closed}</td>
              <td className="px-3 tabular-nums">{r.sla === null ? '—' : `${Math.round(r.sla)}%`}</td>
              <td className="px-3 text-muted-foreground">{r.last}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">No engineers match these filters.</td></tr>}
        </tbody>
      </table>
      <Sheet open={openId !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-[420px] sm:max-w-[420px]">
          <SheetHeader><SheetTitle className="text-2xl">{active?.name}</SheetTitle><SheetDescription>{active?.email}</SheetDescription></SheetHeader>
          {active && (
            <div className="space-y-4 px-4 text-sm">
              <p>{active.open} open items · {active.overdue} overdue · {active.closed} closed</p>
              <Button asChild><Link href={`/people/${active.id}`}>Open full profile</Link></Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
