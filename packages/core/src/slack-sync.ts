import type { NewPerson } from '@dd/db';
import { SLACK_TARGETS, type PeopleIssue, type Person, type SlackMapping, type SlackProfile, type SlackSyncResult, type SlackSyncRow, type SlackTarget } from '@dd/shared';
import { nameFromEmail } from './ingest.ts';

/** Person columns a sync writes straight from a Slack value. `title` and `team` are handled separately (fill-if-empty). */
const COLUMNS = ['department', 'division', 'organization', 'costCenter', 'employeeNumber', 'employeeType', 'location', 'timezone'] as const;
type Column = (typeof COLUMNS)[number];

export interface SlackSyncPlanned {
  email: string;
  slackUserId: string;
  existing: Person | null;
  create: NewPerson;
  patch: Partial<Omit<Person, 'id'>>;
  viaChain: boolean;
}

export interface SlackSyncPlan extends Omit<SlackSyncResult, 'dryRun' | 'syncedAt'> {
  planned: SlackSyncPlanned[];
  /** email -> manager email, for links that passed every check. */
  links: Map<string, string>;
}

export interface SlackSyncOptions {
  mapping: SlackMapping;
  /** Slack user ids to import. */
  selected: Set<string>;
  withChain: boolean;
  overwrite: boolean;
}

/**
 * Pure: turns Slack profiles into creates, updates and manager links for the people the user selected. Nothing is
 * written here. A manager link set by hand or CSV is never overwritten; only links that came from Slack are refreshed.
 * Slack never blanks a value that is already saved.
 */
export function planSlackSync(profiles: SlackProfile[], existing: Person[], o: SlackSyncOptions): SlackSyncPlan {
  const issues: PeopleIssue[] = [];
  const warn = (email: string, message: string) => issues.push({ rowNo: 0, email, level: 'warning', message });
  const bySlackId = new Map(profiles.map((p) => [p.slackUserId, p]));
  const val = (p: SlackProfile, t: SlackTarget): string | null => { const k = o.mapping[t]; return (k && p.values[k]) || null; };

  // The import set: what was ticked, plus (optionally) every manager above them.
  const include = new Map<string, boolean>(); // slack id -> viaChain
  for (const id of o.selected) if (bySlackId.has(id)) include.set(id, false);
  if (o.withChain) {
    for (const id of [...include.keys()]) {
      for (let at = bySlackId.get(id), hops = 0; at && hops < 20; hops++) {
        const m = val(at, 'manager');
        if (!m || !bySlackId.has(m)) break;
        if (!include.has(m)) include.set(m, true);
        at = bySlackId.get(m);
      }
    }
  }

  const byEmail = new Map(existing.map((p) => [p.email, p]));
  const bySlackOwner = new Map(existing.flatMap((p) => (p.slackUserId ? [[p.slackUserId, p] as const] : [])));
  const idToEmail = new Map(existing.map((p) => [p.id, p.email]));

  const planned: SlackSyncPlanned[] = [];
  for (const [slackId, viaChain] of include) {
    const p = bySlackId.get(slackId)!;
    const cur = byEmail.get(p.email) ?? bySlackOwner.get(slackId) ?? null;
    const email = cur?.email ?? p.email;
    const patch: Partial<Omit<Person, 'id'>> = {};
    const put = (k: string, v: string | null, current: string | null | undefined) => {
      if (v !== null && v !== current) (patch as Record<string, unknown>)[k] = v;
    };
    put('slackUserId', slackId, cur?.slackUserId);
    for (const c of COLUMNS) put(c, val(p, c), cur?.[c as Column]);
    for (const k of ['title', 'team'] as const) {
      const v = val(p, k);
      if (v !== null && v !== (cur?.[k] ?? null) && (o.overwrite || !cur?.[k])) (patch as Record<string, unknown>)[k] = v;
    }
    const create: NewPerson = {
      email, name: p.name || nameFromEmail(email), slackUserId: slackId,
      ...Object.fromEntries((['title', 'team', ...COLUMNS] as const).flatMap((k) => { const v = val(p, k); return v ? [[k, v]] : []; })),
    };
    planned.push({ email, slackUserId: slackId, existing: cur, create, patch, viaChain });
  }

  // Manager links, resolved by Slack id -> email and checked against what is already on file.
  const plannedEmail = new Map(planned.map((pl) => [pl.slackUserId, pl.email]));
  const finalEmails = new Set([...existing.map((p) => p.email), ...planned.map((pl) => pl.email)]);
  const known = new Map<string, string | null>(existing.map((p) => [p.email, p.managerId != null ? idToEmail.get(p.managerId) ?? null : null]));
  for (const pl of planned) if (!known.has(pl.email)) known.set(pl.email, null);
  const links = new Map<string, string>();
  const change = new Map<string, SlackSyncRow['managerChange']>();
  let withoutManager = 0;
  let keptManual = 0;

  if (o.mapping.manager) {
    for (const pl of planned) {
      const prof = bySlackId.get(pl.slackUserId)!;
      const mid = val(prof, 'manager');
      if (!mid) { withoutManager++; continue; }
      const mgr = bySlackId.get(mid);
      const mgrEmail = plannedEmail.get(mid) ?? (mgr ? (byEmail.get(mgr.email)?.email ?? mgr.email) : undefined);
      if (!mgr || !mgrEmail) { warn(pl.email, `Manager ${mid} is not an active employee in Slack; manager not set`); change.set(pl.email, 'unresolved'); continue; }
      if (mgrEmail === pl.email) { warn(pl.email, 'Lists themselves as manager; ignored'); continue; }
      if (!finalEmails.has(mgrEmail)) { warn(pl.email, `Manager ${mgr.name} is not being imported; turn on "Include their managers" or select them too`); change.set(pl.email, 'unresolved'); continue; }
      const curMgr = known.get(pl.email) ?? null;
      if (curMgr === mgrEmail) continue;
      if (pl.existing && pl.existing.managerId != null && pl.existing.managerSource !== 'slack') { keptManual++; change.set(pl.email, 'kept-manual'); continue; }
      let loop = false;
      for (let at: string | null | undefined = mgrEmail, hops = 0; at && hops < 10_000; at = known.get(at), hops++) if (at === pl.email) { loop = true; break; }
      if (loop) { warn(pl.email, `Reporting to ${mgrEmail} would create a loop; manager not set`); change.set(pl.email, 'unresolved'); continue; }
      known.set(pl.email, mgrEmail);
      links.set(pl.email, mgrEmail);
      change.set(pl.email, curMgr ? 'changed' : 'set');
    }
  }

  const rows: SlackSyncRow[] = planned.map((pl) => {
    const changes: SlackSyncRow['changes'] = {};
    for (const [k, v] of Object.entries(pl.patch)) changes[k] = [pl.existing ? String((pl.existing as unknown as Record<string, unknown>)[k] ?? '') || null : null, v == null ? null : String(v)];
    const action: SlackSyncRow['action'] = !pl.existing ? 'create' : Object.keys(changes).length || links.has(pl.email) ? 'update' : 'unchanged';
    return { email: pl.email, name: pl.existing?.name ?? pl.create.name, action, viaChain: pl.viaChain, changes, manager: links.get(pl.email) ?? known.get(pl.email) ?? null, managerChange: change.get(pl.email) ?? null };
  }).sort((a, b) => ({ create: 0, update: 1, unchanged: 2 })[a.action] - ({ create: 0, update: 1, unchanged: 2 })[b.action] || a.name.localeCompare(b.name));

  // A mapped field nobody in the selection has a value for would silently save nothing: say so.
  const emptyTargets = SLACK_TARGETS.map((t) => t.key).filter((t) => o.mapping[t] && !planned.some((pl) => { const p = bySlackId.get(pl.slackUserId)!; return val(p, t) !== null; }));

  return {
    selected: [...include.values()].filter((v) => !v).length, chainAdded: [...include.values()].filter(Boolean).length,
    created: rows.filter((r) => r.action === 'create').length, updated: rows.filter((r) => r.action === 'update').length,
    unchanged: rows.filter((r) => r.action === 'unchanged').length, managersLinked: links.size, managersKeptManual: keptManual, withoutManager,
    emptyTargets, issues, rows, planned, links,
  };
}
