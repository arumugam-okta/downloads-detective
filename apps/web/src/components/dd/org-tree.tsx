'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronDown, ChevronRight, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TreeRow {
  id: number; label: string; subtitle: string; depth: number; open: number; overdue: number; closed: number; sla: number | null; hasChildren: boolean; href: string; parentId: number | null;
}

/** Expandable hierarchy table. Rollups arrive precomputed; this only handles expansion and sorting. */
export function OrgTree({ rows, defaultOpen, flat = false, highlight }: { rows: TreeRow[]; defaultOpen: number[]; flat?: boolean; highlight?: number }) {
  const [open, setOpen] = useState(new Set(defaultOpen));
  const [sort, setSort] = useState<{ key: 'open' | 'overdue' | 'closed' | 'sla'; dir: 1 | -1 } | null>(null);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const visible = (r: TreeRow): boolean => { for (let p = r.parentId; p !== null; p = byId.get(p)?.parentId ?? null) { if (!byId.has(p)) break; if (!open.has(p)) return false; } return true; };
  let shown = flat ? rows.filter((r) => !r.hasChildren || r.depth > 0).filter((r) => r.depth > 0 && !rows.some((x) => x.parentId === r.id)) : rows.filter(visible);
  if (sort) shown = [...shown].sort((a, b) => (((a[sort.key] ?? -1) as number) - ((b[sort.key] ?? -1) as number)) * sort.dir);
  const th = (key: 'open' | 'overdue' | 'closed' | 'sla', label: string) => (
    <th className="w-28 px-3 py-2 text-left font-medium"><button type="button" aria-label={`Sort by ${label}`} className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => (s?.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 }))}>{label}<ArrowUpDown className="size-3" aria-hidden /></button></th>
  );
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/60 text-xs text-muted-foreground"><tr><th className="px-5 py-2 text-left font-medium">Org unit{flat ? '' : ' / owner'}</th>{th('open', 'Open')}{th('overdue', 'Overdue')}{th('closed', 'Closed')}{th('sla', 'SLA')}</tr></thead>
      <tbody>
        {shown.map((r) => (
          <tr key={r.id} className={cn('border-t', r.id === highlight && 'bg-accent')}>
            <td className="py-2.5 pr-3" style={{ paddingLeft: 20 + (flat ? 0 : r.depth * 20) }}>
              <div className="flex items-center gap-2">
                {!flat && (r.hasChildren
                  ? <button type="button" aria-label={open.has(r.id) ? `Collapse ${r.label}` : `Expand ${r.label}`} aria-expanded={open.has(r.id)} className="grid size-5 place-items-center rounded hover:bg-muted" onClick={() => setOpen((o) => { const n = new Set(o); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })}>{open.has(r.id) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button>
                  : <span className="size-5" />)}
                <Link href={r.href} className="group">
                  <div className="font-medium group-hover:underline">{r.label}</div>
                  <div className="text-xs text-muted-foreground">{r.subtitle}</div>
                </Link>
              </div>
            </td>
            <td className="px-3 tabular-nums">{r.open}</td>
            <td className={cn('px-3 tabular-nums', r.overdue > 0 && 'text-destructive')}>{r.overdue}</td>
            <td className="px-3 tabular-nums">{r.closed}</td>
            <td className="px-3 tabular-nums">{r.sla === null ? '—' : `${r.sla.toFixed(1)}%`}</td>
          </tr>
        ))}
        {shown.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">Nothing to show.</td></tr>}
      </tbody>
    </table>
  );
}
