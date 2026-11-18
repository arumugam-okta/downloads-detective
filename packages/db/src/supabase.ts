import { createClient } from '@supabase/supabase-js';
import {
  DEFAULT_POLICY, type AuditEvent, type ImportIssue, type Item, type ItemFile, type Person, type Policy, type ReportImport,
} from '@dd/shared';
import type { AuditQuery, ItemPatch, NewAudit, NewItem, NewPerson, Store } from './store.ts';

type Row = Record<string, unknown>;
type Res = { data: unknown; error: { message: string } | null; count?: number | null };

const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const mapKeys = (o: Row, f: (k: string) => string): Row => Object.fromEntries(Object.entries(o).map(([k, v]) => [f(k), v]));
const fromRow = <T>(r: Row): T => mapKeys(r, toCamel) as T;
const toRow = (o: object): Row => mapKeys(o as Row, toSnake);

function ok(res: Res, what: string): unknown {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}
/** A query that must return exactly one row (.single()). */
const one = <T>(res: Res, what: string): T => {
  const d = ok(res, what) as Row | null;
  if (!d) throw new Error(`${what}: no row returned`);
  return fromRow<T>(d);
};
/** A query that may return no row (.maybeSingle()). */
const maybe = <T>(res: Res, what: string): T | null => {
  const d = ok(res, what) as Row | null;
  return d ? fromRow<T>(d) : null;
};
const many = <T>(res: Res, what: string): T[] => ((ok(res, what) as Row[] | null) ?? []).map((r) => fromRow<T>(r));
const done = (res: Res, what: string): void => void ok(res, what);

export interface SupabaseStoreOptions {
  /** API base URL (IDDB_API_URL). supabase-js appends /rest/v1. */
  url: string;
  /** The key to send as apikey (IDDB_ANON_KEY). Row-level security applies to whatever role it maps to. */
  key: string;
  /** Postgres schema holding the dd_* tables. On OAP this is the tenant schema. */
  schema?: string;
  /** Test seam. */
  fetch?: typeof fetch;
}

/** The Store over @supabase/supabase-js, pointed at an OAP tenant (or any Supabase/PostgREST endpoint). */
export class SupabaseStore implements Store {
  private db;

  constructor(o: SupabaseStoreOptions) {
    this.db = createClient(o.url, o.key, {
      db: { schema: o.schema ?? 'public' },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      ...(o.fetch ? { global: { fetch: o.fetch } } : {}),
    });
  }

  // ---- people
  async listPeople() {
    return many<Person>(await this.db.from('dd_people').select('*').order('id'), 'listPeople');
  }
  async getPerson(id: number) {
    return maybe<Person>(await this.db.from('dd_people').select('*').eq('id', id).maybeSingle(), 'getPerson');
  }
  async getPersonByEmail(email: string) {
    return maybe<Person>(await this.db.from('dd_people').select('*').eq('email', email.toLowerCase()).maybeSingle(), 'getPersonByEmail');
  }
  async upsertPersonByEmail(p: NewPerson) {
    const email = p.email.toLowerCase();
    const existing = await this.getPersonByEmail(email);
    if (existing) return existing;
    const res = await this.db.from('dd_people').insert(toRow({ ...p, email })).select('*').single();
    // Two requests for the same new person can race; the unique email makes the loser fail, so read the winner.
    if (res.error && /duplicate|unique/i.test(res.error.message)) {
      const winner = await this.getPersonByEmail(email);
      if (winner) return winner;
    }
    return one<Person>(res, 'upsertPersonByEmail');
  }
  async updatePerson(id: number, patch: Partial<Omit<Person, 'id'>>) {
    return one<Person>(await this.db.from('dd_people').update(toRow(patch)).eq('id', id).select('*').single(), 'updatePerson');
  }

  // ---- items
  async createItem(i: NewItem) {
    return one<Item>(await this.db.from('dd_cleanup_items').insert(toRow(i)).select('*').single(), 'createItem');
  }
  async getItem(id: number) {
    return maybe<Item>(await this.db.from('dd_cleanup_items').select('*').eq('id', id).maybeSingle(), 'getItem');
  }
  async findItem(engineerId: number, caseNumber: string) {
    return maybe<Item>(
      await this.db.from('dd_cleanup_items').select('*').eq('engineer_id', engineerId).eq('case_number', caseNumber).maybeSingle(),
      'findItem',
    );
  }
  async updateItem(id: number, patch: ItemPatch) {
    return one<Item>(await this.db.from('dd_cleanup_items').update(toRow(patch)).eq('id', id).select('*').single(), 'updateItem');
  }
  async listItems(f?: { engineerIds?: number[]; states?: Item['state'][] }) {
    let q = this.db.from('dd_cleanup_items').select('*');
    if (f?.engineerIds) q = q.in('engineer_id', f.engineerIds);
    if (f?.states) q = q.in('state', f.states);
    return many<Item>(await pageAll(q.order('id')), 'listItems');
  }

  // ---- files
  async existingFingerprints(fps: string[]) {
    const out = new Set<string>();
    for (let i = 0; i < fps.length; i += 100) {
      const rows = (ok(await this.db.from('dd_item_files').select('fingerprint').in('fingerprint', fps.slice(i, i + 100)), 'existingFingerprints') as Row[] | null) ?? [];
      for (const r of rows) out.add(r.fingerprint as string);
    }
    return out;
  }
  async addFiles(files: ItemFile[]) {
    if (!files.length) return;
    done(await this.db.from('dd_item_files').upsert(files.map(toRow), { onConflict: 'fingerprint', ignoreDuplicates: true }), 'addFiles');
  }
  async listFiles(itemIds: number[]) {
    const out: ItemFile[] = [];
    for (let i = 0; i < itemIds.length; i += 100) {
      out.push(...many<ItemFile>(await pageAll(this.db.from('dd_item_files').select('*').in('item_id', itemIds.slice(i, i + 100)).order('downloaded_on')), 'listFiles'));
    }
    return out.sort((a, b) => a.downloadedOn.localeCompare(b.downloadedOn));
  }

  // ---- imports
  async createImport(i: Pick<ReportImport, 'filename' | 'source'>) {
    return one<ReportImport>(await this.db.from('dd_report_imports').insert(toRow(i)).select('*').single(), 'createImport');
  }
  async updateImport(id: number, patch: Partial<Omit<ReportImport, 'id'>>) {
    return one<ReportImport>(await this.db.from('dd_report_imports').update(toRow(patch)).eq('id', id).select('*').single(), 'updateImport');
  }
  async listImports(limit: number) {
    return many<ReportImport>(await this.db.from('dd_report_imports').select('*').order('id', { ascending: false }).limit(limit), 'listImports');
  }
  async addIssue(i: Omit<ImportIssue, 'id' | 'createdAt' | 'resolvedAt'>) {
    return one<ImportIssue>(await this.db.from('dd_import_issues').insert(toRow(i)).select('*').single(), 'addIssue');
  }
  async listIssues(f?: { importId?: number; unresolvedOnly?: boolean }) {
    let q = this.db.from('dd_import_issues').select('*');
    if (f?.importId !== undefined) q = q.eq('import_id', f.importId);
    if (f?.unresolvedOnly) q = q.is('resolved_at', null);
    return many<ImportIssue>(await pageAll(q.order('id')), 'listIssues');
  }
  async resolveIssue(id: number) {
    done(await this.db.from('dd_import_issues').update({ resolved_at: new Date().toISOString() }).eq('id', id), 'resolveIssue');
  }

  // ---- audit
  async appendAudit(e: NewAudit) {
    done(await this.db.from('dd_audit_events').insert(toRow(e)), 'appendAudit');
  }
  async listAudit(q: AuditQuery) {
    let b = this.db.from('dd_audit_events').select('*', { count: 'exact' });
    if (q.actorLabel) b = b.eq('actor_label', q.actorLabel);
    if (q.action) b = b.eq('action', q.action);
    if (q.itemId !== undefined) b = b.eq('item_id', q.itemId);
    if (q.from) b = b.gte('at', q.from);
    if (q.to) b = b.lte('at', q.to);
    const res = await b.order('at', { ascending: false }).order('id', { ascending: false }).range(q.offset, q.offset + q.limit - 1);
    const events = many<AuditEvent>(res, 'listAudit');
    return { total: res.count ?? events.length, events };
  }

  // ---- policy
  private async latestPolicyRow(): Promise<Row | null> {
    return ok(
      await this.db.from('dd_policy_settings').select('*').eq('key', 'cleanup').order('version', { ascending: false }).limit(1).maybeSingle(),
      'latestPolicyRow',
    ) as Row | null;
  }
  async getPolicy(): Promise<Policy> {
    const r = await this.latestPolicyRow();
    if (!r) return { ...DEFAULT_POLICY };
    // Policies saved before escalation levels existed carry one delay (manager -> director). That is now the step.
    const { directorAfterBreachHours, ...saved } = r.value as Partial<Policy> & { directorAfterBreachHours?: number };
    return { ...DEFAULT_POLICY, ...(directorAfterBreachHours && saved.escalationStepHours === undefined ? { escalationStepHours: directorAfterBreachHours } : {}), ...saved };
  }
  async setPolicy(p: Policy, changedBy: number | null) {
    const cur = await this.latestPolicyRow();
    done(
      await this.db.from('dd_policy_settings').insert({ key: 'cleanup', version: ((cur?.version as number | undefined) ?? 0) + 1, value: p, changed_by: changedBy }),
      'setPolicy',
    );
  }
}

const PAGE = 1000;

/** PostgREST caps a response (commonly 1000 rows). Walk every page so a list is never silently truncated. */
async function pageAll(q: { range(from: number, to: number): PromiseLike<Res> }): Promise<Res> {
  const all: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await q.range(from, from + PAGE - 1);
    if (res.error) return res;
    const rows = (res.data as unknown[] | null) ?? [];
    all.push(...rows);
    if (rows.length < PAGE) return { data: all, error: null };
  }
}
