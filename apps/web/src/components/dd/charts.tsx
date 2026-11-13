'use client';

import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

/** Every chart has a table twin: the value is never reachable only through hover. */
function WithTable({ children, table }: { children: React.ReactNode; table: { head: string[]; rows: Array<Array<string | number>> } }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div>
      <div className="-mt-9 mb-2 flex justify-end">
        <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">{table.head.map((h, i) => <th key={h} className={cn('py-1 font-medium', i > 0 && 'text-right')}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t">{r.map((c, j) => <td key={j} className={cn('py-1.5', j > 0 && 'text-right tabular-nums')}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : children}
    </div>
  );
}

const statusConfig = {
  open: { label: 'Open', color: 'var(--chart-3)' },
  acknowledged: { label: 'Acknowledged', color: 'var(--chart-1)' },
  overdue: { label: 'Overdue', color: 'var(--chart-4)' },
} satisfies ChartConfig;

export function StatusByEngineer({ data }: { data: Array<{ name: string; open: number; acknowledged: number; overdue: number }> }) {
  return (
    <WithTable table={{ head: ['Engineer', 'Open', 'Acknowledged', 'Overdue'], rows: data.map((d) => [d.name, d.open, d.acknowledged, d.overdue]) }}>
      <ChartContainer config={statusConfig} className="aspect-auto h-[190px] w-full">
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 8 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} strokeOpacity={0.5} />
          <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} width={56} tick={{ fontSize: 12 }} />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} verticalAlign="top" />
          <Bar dataKey="open" stackId="a" fill="var(--color-open)" radius={0} maxBarSize={14} stroke="var(--card)" strokeWidth={1} />
          <Bar dataKey="acknowledged" stackId="a" fill="var(--color-acknowledged)" radius={0} maxBarSize={14} stroke="var(--card)" strokeWidth={1} />
          <Bar dataKey="overdue" stackId="a" fill="var(--color-overdue)" radius={[0, 4, 4, 0]} maxBarSize={14} stroke="var(--card)" strokeWidth={1} />
        </BarChart>
      </ChartContainer>
    </WithTable>
  );
}

const line1 = { open: { label: 'Open items', color: 'var(--chart-1)' } } satisfies ChartConfig;

export function OpenOverTime({ data }: { data: Array<{ day: string; open: number }> }) {
  const max = Math.max(4, ...data.map((d) => d.open));
  const top = Math.ceil(max / 8) * 8;
  return (
    <WithTable table={{ head: ['Day', 'Open items'], rows: data.map((d) => [d.day, d.open]) }}>
      <ChartContainer config={line1} className="aspect-auto h-[190px] w-full">
        <LineChart data={data} margin={{ left: -16, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.5} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tickFormatter={(v: string) => new Date(`${v}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} interval="preserveStartEnd" minTickGap={40} tick={{ fontSize: 12 }} />
          <YAxis tickLine={false} axisLine={false} domain={[0, top]} tickCount={4} allowDecimals={false} tick={{ fontSize: 12 }} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line dataKey="open" type="monotone" stroke="var(--color-open)" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>
    </WithTable>
  );
}

const bar1 = { count: { label: 'Open items', color: 'var(--chart-1)' } } satisfies ChartConfig;

export function Aging({ data }: { data: Array<{ bucket: string; count: number }> }) {
  return (
    <WithTable table={{ head: ['Age since case closed', 'Open items'], rows: data.map((d) => [d.bucket, d.count]) }}>
      <ChartContainer config={bar1} className="aspect-auto h-[190px] w-full">
        <BarChart data={data} margin={{ left: -16, right: 8, top: 18 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.5} />
          <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} tickCount={4} tick={{ fontSize: 12 }} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} maxBarSize={22} label={{ position: 'top', fontSize: 12, fill: 'var(--foreground)' }} />
        </BarChart>
      </ChartContainer>
    </WithTable>
  );
}

const slaConfig = { pct: { label: 'SLA met', color: 'var(--chart-1)' } } satisfies ChartConfig;

export function SlaByTeam({ data }: { data: Array<{ team: string; pct: number }> }) {
  return (
    <WithTable table={{ head: ['Team', 'SLA met'], rows: data.map((d) => [d.team, `${d.pct.toFixed(1)}%`]) }}>
      <ChartContainer config={slaConfig} className="aspect-auto h-[230px] w-full">
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 44 }} barCategoryGap={10}>
          <YAxis dataKey="team" type="category" tickLine={false} axisLine={false} width={104} tick={{ fontSize: 12 }} />
          <XAxis type="number" domain={[0, 100]} hide />
          <ChartTooltip content={<ChartTooltipContent formatter={(v) => `${Number(v).toFixed(1)}%`} />} />
          <Bar dataKey="pct" fill="var(--color-pct)" radius={[0, 4, 4, 0]} maxBarSize={12} label={{ position: 'right', fontSize: 12, fill: 'var(--foreground)', formatter: (v: unknown) => `${Number(v).toFixed(1)}%` }} />
        </BarChart>
      </ChartContainer>
    </WithTable>
  );
}

const flowConfig = {
  ingested: { label: 'Ingested', color: 'var(--chart-1)' },
  closed: { label: 'Closed', color: 'var(--chart-2)' },
} satisfies ChartConfig;

export function IngestedVsClosed({ data }: { data: Array<{ week: string; ingested: number; closed: number }> }) {
  return (
    <WithTable table={{ head: ['Week ending', 'Ingested', 'Closed'], rows: data.map((d) => [d.week, d.ingested, d.closed]) }}>
      <ChartContainer config={flowConfig} className="aspect-auto h-[230px] w-full">
        <LineChart data={data} margin={{ left: -16, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.5} />
          <XAxis dataKey="week" tickLine={false} axisLine={false} tickFormatter={(v: string) => new Date(`${v}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} tick={{ fontSize: 12 }} />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} tickCount={4} tick={{ fontSize: 12 }} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} verticalAlign="top" align="left" />
          <Line dataKey="ingested" type="monotone" stroke="var(--color-ingested)" strokeWidth={2} dot={false} />
          <Line dataKey="closed" type="monotone" stroke="var(--color-closed)" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>
    </WithTable>
  );
}

/** Stacked status bar: segments separated by a 2px surface gap, not a border. */
export function StatusDistribution({ parts }: { parts: Array<{ key: string; label: string; value: number; color: string }> }) {
  const total = parts.reduce((n, p) => n + p.value, 0) || 1;
  return (
    <WithTable table={{ head: ['Status', 'Items'], rows: parts.map((p) => [p.label, p.value]) }}>
      <div>
        <div className="flex h-6 w-full gap-0.5 overflow-hidden rounded-md" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
          {parts.filter((p) => p.value > 0).map((p) => <div key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.value}`} />)}
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4">
          {parts.map((p) => (
            <div key={p.key}>
              <dt className="flex items-center gap-2 text-[13px] text-muted-foreground"><span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden />{p.label}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{p.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </WithTable>
  );
}

/** Overdue-by-team-and-week heatmap. Darker = more overdue; the number is always printed in the cell. */
export function Heatmap({ weeks, rows }: { weeks: string[]; rows: Array<{ team: string; cells: number[] }> }) {
  const max = Math.max(1, ...rows.flatMap((r) => r.cells));
  const step = (v: number) => Math.min(4, Math.ceil((v / max) * 4));
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return (
    <WithTable table={{ head: ['Team', ...weeks.map(fmt)], rows: rows.map((r) => [r.team, ...r.cells]) }}>
      <div className="grid gap-1" style={{ gridTemplateColumns: `minmax(92px,auto) repeat(${weeks.length}, 1fr)` }}>
        {rows.map((r) => (
          <div key={r.team} className="contents">
            <div className="self-center pr-2 text-xs text-muted-foreground">{r.team}</div>
            {r.cells.map((c, i) => {
              const s = c === 0 ? 0 : step(c);
              return (
                <div key={i} title={`${r.team}, week ending ${fmt(weeks[i]!)}: ${c} overdue`} className="grid h-6 place-items-center rounded text-xs font-medium tabular-nums"
                  style={{ background: `var(--heat-${s})`, color: s >= 3 ? '#fff' : 'var(--heat-ink-light)' }}>
                  {c}
                </div>
              );
            })}
          </div>
        ))}
        <div />
        {weeks.map((w) => <div key={w} className="pt-1 text-center text-xs text-muted-foreground">{fmt(w)}</div>)}
      </div>
    </WithTable>
  );
}

export { Cell };
