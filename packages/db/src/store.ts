import type {
  AuditEvent, ImportIssue, IssueKind, Item, ItemFile, Person, Policy, ReportImport,
} from '@dd/shared';

export type NewPerson = Pick<Person, 'email' | 'name'> & Partial<Omit<Person, 'id' | 'email' | 'name'>>;

export interface NewItem {
  engineerId: number;
  caseNumber: string;
  caseSubject: string | null;
  caseClosedAt: string;
  dueAt: string;
  state: Item['state'];
  createdImportId: number | null;
}

export type ItemPatch = Partial<Omit<Item, 'id' | 'ref' | 'caseNumber' | 'createdAt'>>;

export interface NewAudit {
  /** Defaults to now. Only the seed passes this, to backfill history. */
  at?: string;
  actorId: number | null;
  actorLabel: string;
  action: string;
  itemId?: number | null;
  importId?: number | null;
  detail?: string | null;
}

export interface AuditQuery {
  actorLabel?: string;
  action?: string;
  itemId?: number;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

/**
 * Every read and write the app needs, implemented by SupabaseStore over @supabase/supabase-js.
 * The slack-service is the only writer of lifecycle state; the web app only reads.
 */
export interface Store {
  // people
  listPeople(): Promise<Person[]>;
  getPerson(id: number): Promise<Person | null>;
  getPersonByEmail(email: string): Promise<Person | null>;
  /** Creates a placeholder person (no manager, no Slack id) when the email is new. */
  upsertPersonByEmail(p: NewPerson): Promise<Person>;
  updatePerson(id: number, patch: Partial<Omit<Person, 'id'>>): Promise<Person>;

  // items
  createItem(i: NewItem): Promise<Item>;
  getItem(id: number): Promise<Item | null>;
  findItem(engineerId: number, caseNumber: string): Promise<Item | null>;
  updateItem(id: number, patch: ItemPatch): Promise<Item>;
  listItems(filter?: { engineerIds?: number[]; states?: Item['state'][] }): Promise<Item[]>;

  // files
  /** Returns the subset of fingerprints that already exist. */
  existingFingerprints(fps: string[]): Promise<Set<string>>;
  addFiles(files: ItemFile[]): Promise<void>;
  listFiles(itemIds: number[]): Promise<ItemFile[]>;

  // imports and their issues
  createImport(i: Pick<ReportImport, 'filename' | 'source'>): Promise<ReportImport>;
  updateImport(id: number, patch: Partial<Omit<ReportImport, 'id'>>): Promise<ReportImport>;
  listImports(limit: number): Promise<ReportImport[]>;
  addIssue(i: Omit<ImportIssue, 'id' | 'createdAt' | 'resolvedAt'>): Promise<ImportIssue>;
  listIssues(filter?: { importId?: number; unresolvedOnly?: boolean }): Promise<ImportIssue[]>;
  resolveIssue(id: number): Promise<void>;

  // audit (append-only)
  appendAudit(e: NewAudit): Promise<void>;
  listAudit(q: AuditQuery): Promise<{ total: number; events: AuditEvent[] }>;

  // policy
  getPolicy(): Promise<Policy>;
  setPolicy(p: Policy, changedBy: number | null): Promise<void>;
}

export type { IssueKind };
