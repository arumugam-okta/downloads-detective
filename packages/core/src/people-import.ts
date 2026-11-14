import { parse } from 'csv-parse/sync';
import {
  PEOPLE_FIELDS, SLACK_ID_RE, managerChain, type PeopleCsvInspection, type PeopleField, type PeopleImportResult, type PeopleIssue,
  type PeopleMapping, type Person,
} from '@dd/shared';
import type { NewPerson } from '@dd/db';
import { ReportFormatError, nameFromEmail } from './ingest.ts';

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Header spellings we recognise for each field, compared after stripping punctuation and case. */
const SYNONYMS: Record<PeopleField, string[]> = {
  email: ['email', 'emailaddress', 'workemail', 'primaryemail', 'login', 'username', 'userprincipalname', 'upn'],
  name: ['name', 'fullname', 'displayname', 'employeename'],
  title: ['title', 'jobtitle', 'position'],
  team: ['team', 'department', 'dept', 'org', 'organization', 'division', 'group', 'costcenter'],
  managerEmail: ['manageremail', 'manager', 'managerid', 'managername', 'reportsto', 'supervisor', 'supervisoremail', 'lead', 'linemanager'],
  roles: ['roles', 'role', 'accesslevel', 'permissions', 'permission', 'userroles'],
  slackUserId: ['slackuserid', 'slackid', 'slackmemberid', 'slack'],
  active: ['active', 'status', 'enabled', 'isactive', 'employmentstatus'],
};

function readCsv(csv: string): { headers: string[]; records: Record<string, string>[] } {
  let headers: string[] = [];
  let records: Record<string, string>[];
  try {
    records = parse(csv, {
      columns: (h: string[]) => { headers = h.map((x) => x.trim()); return headers; },
      skip_empty_lines: true, trim: true, bom: true, relax_column_count: true,
    });
  } catch (e) {
    throw new ReportFormatError(`Could not read CSV: ${(e as Error).message}`);
  }
  if (headers.length === 0 || records.length === 0) throw new ReportFormatError('The file has no rows');
  return { headers, records };
}

export function inspectPeopleCsv(csv: string): PeopleCsvInspection {
  const { headers, records } = readCsv(csv);
  const suggested: PeopleMapping = {};
  const used = new Set<string>();
  for (const f of PEOPLE_FIELDS) {
    const hit = headers.find((h) => !used.has(h) && SYNONYMS[f.key].includes(norm(h)));
    if (hit) { suggested[f.key] = hit; used.add(hit); }
  }
  return { headers, total: records.length, sample: records.slice(0, 3), suggested };
}

const TRUE = new Set(['true', 'yes', 'y', '1', 'active', 'enabled']);
const FALSE = new Set(['false', 'no', 'n', '0', 'inactive', 'disabled', 'terminated', 'deprovisioned', 'suspended']);

interface Parsed {
  rowNo: number;
  email: string;
  name?: string;
  title?: string;
  team?: string;
  managerEmail?: string;
  slackUserId?: string;
  isManager?: boolean;
  isCompliance?: boolean;
  active?: boolean;
}

export interface PlannedPerson {
  rowNo: number;
  email: string;
  existing: Person | null;
  create: NewPerson;
  patch: Partial<Omit<Person, 'id'>>;
  managerEmail: string | null;
  changed: boolean;
}

export interface PeoplePlan extends Omit<PeopleImportResult, 'dryRun'> {
  planned: PlannedPerson[];
  /** email -> manager email, for links that survived validation. */
  links: Map<string, string>;
}

/** Turns a CSV plus a column mapping into a validated plan. Pure: nothing is written. */
export function planPeopleImport(csv: string, mapping: PeopleMapping, existing: Person[], actor: Person): PeoplePlan {
  const { headers, records } = readCsv(csv);
  if (!mapping.email || !headers.includes(mapping.email)) throw new ReportFormatError('Map the Email column first');
  for (const [k, h] of Object.entries(mapping)) if (h && !headers.includes(h)) throw new ReportFormatError(`Column "${h}" (for ${k}) is not in the file`);

  const issues: PeopleIssue[] = [];
  const issue = (rowNo: number, email: string, level: PeopleIssue['level'], message: string) => issues.push({ rowNo, email, level, message });
  const get = (r: Record<string, string>, f: PeopleField) => (mapping[f] ? (r[mapping[f]!] ?? '').trim() : '');

  const seen = new Map<string, number>();
  const parsed: Parsed[] = [];
  records.forEach((r, i) => {
    const rowNo = i + 2;
    const email = get(r, 'email').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return issue(rowNo, email || '(blank)', 'error', 'Not a valid email address; row skipped');
    if (seen.has(email)) return issue(rowNo, email, 'warning', `Duplicate of row ${seen.get(email)}; this row was ignored`);
    seen.set(email, rowNo);
    const p: Parsed = { rowNo, email };
    for (const f of ['name', 'title', 'team'] as const) { const v = get(r, f); if (v) p[f] = v; }
    const mgr = get(r, 'managerEmail').toLowerCase();
    if (mgr) p.managerEmail = mgr;
    const slack = get(r, 'slackUserId');
    if (slack) {
      if (SLACK_ID_RE.test(slack.toUpperCase())) p.slackUserId = slack.toUpperCase();
      else issue(rowNo, email, 'warning', `"${slack}" is not a Slack member ID; ignored`);
    }
    const act = get(r, 'active').toLowerCase();
    if (act) {
      if (TRUE.has(act)) p.active = true;
      else if (FALSE.has(act)) p.active = false;
      else issue(rowNo, email, 'warning', `"${act}" is not a recognised active/inactive value; ignored`);
    }
    if (mapping.roles) {
      // A mapped roles column is authoritative: an empty cell means "no extra roles".
      const tokens = get(r, 'roles').toLowerCase().split(/[;,|/\s]+/).filter(Boolean);
      for (const t of tokens) if (!['engineer', 'manager', 'compliance'].includes(t)) issue(rowNo, email, 'warning', `Unknown role "${t}"; ignored`);
      p.isManager = tokens.includes('manager');
      p.isCompliance = tokens.includes('compliance');
    }
    parsed.push(p);
  });

  const byEmail = new Map(existing.map((p) => [p.email, p]));
  const planned: PlannedPerson[] = parsed.map((p) => {
    const cur = byEmail.get(p.email) ?? null;
    const patch: Partial<Omit<Person, 'id'>> = {};
    const set = <K extends keyof Omit<Person, 'id'>>(k: K, v: Person[K] | undefined) => {
      if (v !== undefined && (!cur || cur[k] !== v)) patch[k] = v;
    };
    set('name', p.name); set('title', p.title); set('team', p.team); set('slackUserId', p.slackUserId);
    set('isManager', p.isManager); set('isCompliance', p.isCompliance); set('active', p.active);
    const create: NewPerson = {
      email: p.email, name: p.name ?? nameFromEmail(p.email),
      ...(p.title ? { title: p.title } : {}), ...(p.team ? { team: p.team } : {}), ...(p.slackUserId ? { slackUserId: p.slackUserId } : {}),
      ...(p.isManager !== undefined ? { isManager: p.isManager } : {}), ...(p.isCompliance !== undefined ? { isCompliance: p.isCompliance } : {}),
      ...(p.active !== undefined ? { active: p.active } : {}),
    };
    return { rowNo: p.rowNo, email: p.email, existing: cur, create, patch, managerEmail: p.managerEmail ?? null, changed: !cur || Object.keys(patch).length > 0 };
  });

  // Manager links: resolve against everyone known, then reject self-links and cycles.
  const known = new Map<string, string | null>(); // email -> current manager email
  const idToEmail = new Map(existing.map((p) => [p.id, p.email]));
  for (const p of existing) known.set(p.email, p.managerId != null ? (idToEmail.get(p.managerId) ?? null) : null);
  for (const p of planned) if (!known.has(p.email)) known.set(p.email, null);
  const links = new Map<string, string>();
  for (const p of planned) {
    if (!p.managerEmail) continue;
    if (p.managerEmail === p.email) { issue(p.rowNo, p.email, 'warning', 'Cannot report to themselves; manager ignored'); continue; }
    if (!known.has(p.managerEmail)) { issue(p.rowNo, p.email, 'warning', `Manager ${p.managerEmail} is not in the directory or this file; manager ignored`); continue; }
    let cycle = false;
    for (let cur: string | null | undefined = p.managerEmail, hops = 0; cur && hops < 10_000; cur = known.get(cur), hops++) if (cur === p.email) { cycle = true; break; }
    if (cycle) { issue(p.rowNo, p.email, 'warning', `Reporting to ${p.managerEmail} would create a loop; manager ignored`); continue; }
    known.set(p.email, p.managerEmail);
    const curMgr = p.existing?.managerId != null ? idToEmail.get(p.existing.managerId) : null;
    if (curMgr !== p.managerEmail) { links.set(p.email, p.managerEmail); p.changed = true; }
  }

  // Never leave the directory without an active compliance user, and never let an import lock the actor out.
  const finalCompliance = new Set(existing.filter((p) => p.isCompliance && p.active).map((p) => p.email));
  for (const p of planned) {
    const isC = p.patch.isCompliance ?? p.existing?.isCompliance ?? p.create.isCompliance ?? false;
    const isA = p.patch.active ?? p.existing?.active ?? p.create.active ?? true;
    if (isC && isA) finalCompliance.add(p.email); else finalCompliance.delete(p.email);
  }
  const me = planned.find((p) => p.email === actor.email);
  const blocking = me && (me.patch.active === false) ? 'This file would deactivate your own account'
    : me && me.patch.isCompliance === false ? 'This file would remove your own compliance role'
      : finalCompliance.size === 0 ? 'This file would leave no active compliance user' : null;

  const created = planned.filter((p) => !p.existing).length;
  const updated = planned.filter((p) => p.existing && p.changed).length;
  const mgrOf = (e: string) => links.get(e) ?? (() => { const x = byEmail.get(e); return x?.managerId != null ? idToEmail.get(x.managerId) ?? null : null; })();
  return {
    total: records.length, created, updated, unchanged: planned.length - created - updated, managersLinked: links.size, issues, blocking, planned, links,
    rows: planned.map((p) => ({
      rowNo: p.rowNo, email: p.email, name: p.create.name, action: !p.existing ? 'create' : p.changed ? 'update' : 'unchanged', manager: mgrOf(p.email) ?? null,
    })),
  };
}

/** Would pointing `personId` at `managerId` create a loop? */
export const wouldCycle = (people: Person[], personId: number, managerId: number): boolean =>
  managerId === personId || managerChain(people, managerId).some((m) => m.id === personId);
