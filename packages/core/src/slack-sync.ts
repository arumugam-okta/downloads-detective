import type { NewPerson } from '@dd/db';
import type { PeopleIssue, Person, SlackProfile, SlackSyncResult, SlackSyncRow } from '@dd/shared';
import { nameFromEmail } from './ingest.ts';

/** Fields Slack owns: a sync overwrites them whenever Slack has a value, and never blanks them. */
const OWNED = ['slackUserId', 'department', 'division', 'organization', 'costCenter', 'employeeNumber', 'employeeType', 'location', 'timezone'] as const;

export interface SlackSyncPlanned {
  email: string;
  existing: Person | null;
  create: NewPerson;
  patch: Partial<Omit<Person, 'id'>>;
}

export interface SlackSyncPlan extends Omit<SlackSyncResult, 'dryRun' | 'syncedAt'> {
  planned: SlackSyncPlanned[];
  /** email -> manager email, for links that passed every check. */
  links: Map<string, string>;
}

/**
 * Pure: turns Slack profiles into a list of creates, updates and manager links. Nothing is written here.
 * A manager link set by hand (or by CSV) is never overwritten; only links that came from Slack are refreshed.
 */
export function planSlackSync(profiles: SlackProfile[], existing: Person[], opts: { createMissing: boolean }): SlackSyncPlan {
  const issues: PeopleIssue[] = [];
  const warn = (email: string, message: string) => issues.push({ rowNo: 0, email, level: 'warning', message });
  const byEmail = new Map(existing.map((p) => [p.email, p]));
  const bySlack = new Map(existing.flatMap((p) => (p.slackUserId ? [[p.slackUserId, p] as const] : [])));
  const idToEmail = new Map(existing.map((p) => [p.id, p.email]));
  const emailOfSlack = new Map(profiles.map((p) => [p.slackUserId, p.email]));

  const planned: SlackSyncPlanned[] = [];
  const skipped = new Set<string>();
  for (const p of profiles) {
    const cur = byEmail.get(p.email) ?? bySlack.get(p.slackUserId) ?? null;
    if (!cur && !opts.createMissing) { skipped.add(p.email); continue; }
    const email = cur?.email ?? p.email;
    const patch: Partial<Omit<Person, 'id'>> = {};
    for (const k of OWNED) {
      const v = p[k];
      if (v !== null && v !== undefined && (!cur || cur[k] !== v)) (patch as Record<string, unknown>)[k] = v;
    }
    if (cur && !cur.title && p.title) patch.title = p.title;
    if (cur && !cur.team && p.department) patch.team = p.department;
    const create: NewPerson = {
      email, name: p.name || nameFromEmail(email),
      ...(p.title ? { title: p.title } : {}), ...(p.department ? { team: p.department } : {}),
      ...Object.fromEntries(OWNED.flatMap((k) => (p[k] ? [[k, p[k]]] : []))),
    };
    planned.push({ email, existing: cur, create, patch });
  }

  // Manager links, resolved by Slack id -> email, then checked against what is already on file.
  const finalSet = new Set([...existing.map((p) => p.email), ...planned.map((p) => p.email)]);
  const known = new Map<string, string | null>(existing.map((p) => [p.email, p.managerId != null ? idToEmail.get(p.managerId) ?? null : null]));
  for (const p of planned) if (!known.has(p.email)) known.set(p.email, null);
  const links = new Map<string, string>();
  const change = new Map<string, SlackSyncRow['managerChange']>();
  const profileOf = new Map(profiles.map((p) => [p.email, p]));
  let withoutManager = 0;
  let keptManual = 0;

  for (const pl of planned) {
    const prof = profileOf.get(pl.existing?.email ?? pl.email) ?? profileOf.get(pl.email);
    if (!prof) continue;
    if (!prof.managerSlackId) { withoutManager++; continue; }
    const mgrEmail = emailOfSlack.get(prof.managerSlackId);
    if (!mgrEmail) { warn(pl.email, `Manager ${prof.managerSlackId} is not an active employee in Slack; manager not set`); change.set(pl.email, 'unresolved'); continue; }
    if (mgrEmail === pl.email) { warn(pl.email, 'Lists themselves as manager; ignored'); continue; }
    if (!finalSet.has(mgrEmail)) { warn(pl.email, `Manager ${mgrEmail} is not in the directory; turn on "Add people from Slack" to include them`); change.set(pl.email, 'unresolved'); continue; }
    const cur = pl.existing;
    const curMgr = known.get(pl.email) ?? null;
    if (curMgr === mgrEmail) continue;
    if (cur && cur.managerId != null && cur.managerSource !== 'slack') { keptManual++; change.set(pl.email, 'kept-manual'); continue; }
    let loop = false;
    for (let at: string | null | undefined = mgrEmail, hops = 0; at && hops < 10_000; at = known.get(at), hops++) if (at === pl.email) { loop = true; break; }
    if (loop) { warn(pl.email, `Reporting to ${mgrEmail} would create a loop; manager not set`); change.set(pl.email, 'unresolved'); continue; }
    known.set(pl.email, mgrEmail);
    links.set(pl.email, mgrEmail);
    change.set(pl.email, curMgr ? 'changed' : 'set');
  }

  const rows: SlackSyncRow[] = planned.map((pl) => {
    const changes: SlackSyncRow['changes'] = {};
    for (const [k, v] of Object.entries(pl.patch)) changes[k] = [pl.existing ? ((pl.existing as unknown as Record<string, string | null>)[k] ?? null) : null, v == null ? null : String(v)];
    const mc = change.get(pl.email) ?? null;
    const action: SlackSyncRow['action'] = !pl.existing ? 'create' : Object.keys(changes).length || links.has(pl.email) ? 'update' : 'unchanged';
    return { email: pl.email, name: pl.existing?.name ?? pl.create.name, action, changes, manager: links.get(pl.email) ?? known.get(pl.email) ?? null, managerChange: mc };
  }).sort((a, b) => ({ create: 0, update: 1, unchanged: 2 })[a.action] - ({ create: 0, update: 1, unchanged: 2 })[b.action] || a.name.localeCompare(b.name));

  return {
    scanned: profiles.length, created: rows.filter((r) => r.action === 'create').length, updated: rows.filter((r) => r.action === 'update').length,
    unchanged: rows.filter((r) => r.action === 'unchanged').length, managersLinked: links.size, managersKeptManual: keptManual, withoutManager,
    issues, rows, missingFields: [], planned, links,
  };
}
