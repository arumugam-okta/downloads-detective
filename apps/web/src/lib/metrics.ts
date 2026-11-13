import {
  displayStatus, subtreeIds, type DisplayStatus, type Item, type ItemFile, type Person,
} from '@dd/shared';

const DAY = 86_400_000;

export interface Range {
  from: Date;
  to: Date;
}

export type ItemView = Item & {
  status: DisplayStatus;
  engineer: Person;
  team: string;
  fileCount: number;
};

export function toViews(items: Item[], people: Person[], files: ItemFile[], now: Date): ItemView[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const counts = new Map<number, number>();
  for (const f of files) counts.set(f.itemId, (counts.get(f.itemId) ?? 0) + 1);
  return items.flatMap((i) => {
    const engineer = byId.get(i.engineerId);
    if (!engineer) return [];
    return [{ ...i, status: displayStatus(i.state, new Date(i.dueAt), now), engineer, team: engineer.team ?? 'Unassigned', fileCount: counts.get(i.id) ?? 0 }];
  });
}

export const inRange = (iso: string, r: Range): boolean => {
  const t = new Date(iso).getTime();
  return t >= r.from.getTime() && t <= r.to.getTime();
};

/** An item belongs to a period if it was created in it, or is still open in it. */
export const relevantInRange = (i: Item, r: Range): boolean =>
  inRange(i.createdAt, r) || (i.state !== 'closed' && new Date(i.createdAt) <= r.to) || (i.attestedAt !== null && inRange(i.attestedAt, r));

export interface Rollup {
  total: number;
  open: number;
  acknowledged: number;
  overdue: number;
  closed: number;
  triage: number;
  failed: number;
  /** Open + acknowledged + overdue: everything not yet closed or undeliverable. */
  notClosed: number;
  closedOnTime: number;
  slaPct: number | null;
  closedRatePct: number | null;
  medianDaysToClose: number | null;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

export function rollup(views: ItemView[]): Rollup {
  const r: Rollup = {
    total: views.length, open: 0, acknowledged: 0, overdue: 0, closed: 0, triage: 0, failed: 0, notClosed: 0,
    closedOnTime: 0, slaPct: null, closedRatePct: null, medianDaysToClose: null,
  };
  const days: number[] = [];
  for (const v of views) {
    if (v.status === 'overdue') r.overdue++;
    else r[v.status]++;
    if (v.status === 'closed' && v.attestedAt) {
      if (new Date(v.attestedAt) <= new Date(v.dueAt)) r.closedOnTime++;
      days.push((new Date(v.attestedAt).getTime() - new Date(v.caseClosedAt).getTime()) / DAY);
    }
  }
  r.notClosed = r.open + r.acknowledged + r.overdue;
  r.slaPct = r.closed ? (r.closedOnTime / r.closed) * 100 : null;
  r.closedRatePct = r.total ? (r.closed / r.total) * 100 : null;
  r.medianDaysToClose = median(days);
  return r;
}

export const pct = (v: number | null, digits = 1): string => (v === null ? '—' : `${v.toFixed(digits)}%`);
export const days = (v: number | null): string => (v === null ? '—' : `${v.toFixed(1)}d`);

// ---- org tree

export interface OrgNode {
  person: Person;
  label: string;
  subtitle: string;
  depth: number;
  rollup: Rollup;
  children: OrgNode[];
}

/** Hierarchy rollup: each node aggregates every item owned by anyone in its subtree. */
export function buildOrgTree(people: Person[], views: ItemView[], rootId: number): OrgNode | null {
  const active = people.filter((p) => p.active);
  const kids = new Map<number, Person[]>();
  for (const p of active) if (p.managerId !== null) kids.set(p.managerId, [...(kids.get(p.managerId) ?? []), p]);
  const byEngineer = new Map<number, ItemView[]>();
  for (const v of views) byEngineer.set(v.engineerId, [...(byEngineer.get(v.engineerId) ?? []), v]);

  const walk = (p: Person, depth: number): OrgNode => {
    const children = (kids.get(p.id) ?? []).filter((c) => (kids.get(c.id)?.length ?? 0) > 0).map((c) => walk(c, depth + 1));
    const ids = subtreeIds(active, p.id);
    const mine = [...ids].flatMap((id) => byEngineer.get(id) ?? []);
    return {
      person: p, label: p.team ?? p.name, subtitle: `${p.title ? roleLabel(p.title) : 'Lead'} · ${p.name}`, depth, rollup: rollup(mine),
      children: children.sort((a, b) => b.rollup.overdue - a.rollup.overdue || b.rollup.notClosed - a.rollup.notClosed),
    };
  };
  const root = active.find((p) => p.id === rootId);
  return root ? walk(root, 0) : null;
}

const roleLabel = (title: string): string =>
  /vp/i.test(title) ? 'VP' : /director/i.test(title) ? 'Director' : /manager/i.test(title) ? 'Manager' : title;

export const flattenTree = (n: OrgNode): OrgNode[] => [n, ...n.children.flatMap(flattenTree)];

/** Teams = nodes whose children are all individual contributors. */
export const leafTeams = (n: OrgNode): OrgNode[] => (n.children.length ? n.children.flatMap(leafTeams) : [n]);

// ---- time series

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Items that were not-closed at `at`: created by then and not yet attested. */
export const openAt = (v: Item, at: Date): boolean =>
  new Date(v.createdAt) <= at && (v.attestedAt === null || new Date(v.attestedAt) > at);

export function openOverTime(views: ItemView[], r: Range, points = 14): Array<{ day: string; open: number }> {
  const span = r.to.getTime() - r.from.getTime();
  return Array.from({ length: points }, (_, i) => {
    const at = new Date(r.from.getTime() + (span * i) / (points - 1));
    return { day: at.toISOString().slice(0, 10), open: views.filter((v) => v.state !== 'triage' && v.state !== 'failed' && openAt(v, at)).length };
  });
}

export function weekEndings(r: Range): Date[] {
  const out: Date[] = [];
  const end = startOfDay(r.to);
  for (let t = end.getTime(); t > r.from.getTime() - 7 * DAY && out.length < 12; t -= 7 * DAY) out.unshift(new Date(t));
  return out;
}

export interface WeekRow {
  weekEnding: string;
  ingested: number;
  closed: number;
  overdue: number;
  medianDays: number | null;
  slaPct: number | null;
}

export function weekly(views: ItemView[], r: Range): WeekRow[] {
  return weekEndings(r).map((end) => {
    const to = new Date(end.getTime() + DAY - 1);
    const from = new Date(end.getTime() - 6 * DAY);
    const ingested = views.filter((v) => inRange(v.createdAt, { from, to })).length;
    const closedHere = views.filter((v) => v.attestedAt && inRange(v.attestedAt, { from, to }));
    const onTime = closedHere.filter((v) => new Date(v.attestedAt!) <= new Date(v.dueAt)).length;
    const overdue = views.filter((v) => new Date(v.createdAt) <= to && new Date(v.dueAt) <= to && openAt(v, to) && v.state !== 'triage' && v.state !== 'failed').length;
    return {
      weekEnding: end.toISOString().slice(0, 10), ingested, closed: closedHere.length, overdue,
      medianDays: median(closedHere.map((v) => (new Date(v.attestedAt!).getTime() - new Date(v.caseClosedAt).getTime()) / DAY)),
      slaPct: closedHere.length ? (onTime / closedHere.length) * 100 : null,
    };
  });
}

/** Overdue items per team per week (the heatmap). */
export function overdueHeatmap(views: ItemView[], teams: string[], r: Range): { weeks: string[]; rows: Array<{ team: string; cells: number[] }> } {
  const ends = weekEndings(r).slice(-4);
  return {
    weeks: ends.map((e) => e.toISOString().slice(0, 10)),
    rows: teams.map((team) => ({
      team,
      cells: ends.map((end) => {
        const to = new Date(end.getTime() + DAY - 1);
        return views.filter((v) => v.team === team && new Date(v.dueAt) <= to && openAt(v, to) && v.state !== 'triage' && v.state !== 'failed').length;
      }),
    })),
  };
}

export const AGE_BUCKETS = ['0–1d', '2–3d', '4–5d', '5d+'] as const;
export function aging(views: ItemView[], now: Date): Array<{ bucket: string; count: number }> {
  const counts = [0, 0, 0, 0];
  for (const v of views) {
    if (v.status !== 'open' && v.status !== 'acknowledged' && v.status !== 'overdue') continue;
    const d = (now.getTime() - new Date(v.caseClosedAt).getTime()) / DAY;
    counts[d < 2 ? 0 : d < 4 ? 1 : d < 5.5 ? 2 : 3]!++;
  }
  return AGE_BUCKETS.map((bucket, i) => ({ bucket, count: counts[i]! }));
}

export function humanDue(dueAt: string, now: Date, state: Item['state']): { text: string; overdue: boolean } {
  const ms = new Date(dueAt).getTime() - now.getTime();
  const d = new Date(dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const overdue = ms < 0 && state !== 'closed';
  const abs = Math.abs(ms);
  const days = Math.floor(abs / DAY);
  const hours = Math.floor(abs / 3_600_000);
  const rel = days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : `${Math.max(hours, 1)} hour${hours === 1 ? '' : 's'}`;
  return { text: `${d} · ${ms < 0 ? `${rel} overdue` : `due in ${rel}`}`, overdue };
}

export function relativeTime(iso: string, now: Date): string {
  const s = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) { const h = Math.round(s / 3600); return `${h} hour${h === 1 ? '' : 's'} ago`; }
  const d = Math.round(s / 86_400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export const fmtUtc = (iso: string): string => {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${date} · ${d.toISOString().slice(11, 16)} UTC`;
};
export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export const fmtShort = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
