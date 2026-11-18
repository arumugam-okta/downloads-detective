import type { Person } from './types.ts';

/** Fields a people CSV can carry. `key` is what the mapping is keyed by. */
export const PEOPLE_FIELDS = [
  { key: 'email', label: 'Email', required: true, hint: 'Identifies the person; used for sign-in and Slack lookup' },
  { key: 'name', label: 'Full name', required: false, hint: 'Defaults to a name derived from the email' },
  { key: 'title', label: 'Job title', required: false, hint: '' },
  { key: 'team', label: 'Team', required: false, hint: 'The unit they belong to or lead' },
  { key: 'managerEmail', label: 'Manager email', required: false, hint: 'Builds the reporting hierarchy' },
  { key: 'roles', label: 'Roles', required: false, hint: 'manager, compliance (separate with ; or ,)' },
  { key: 'slackUserId', label: 'Slack member ID', required: false, hint: 'Looked up by email when blank' },
  { key: 'active', label: 'Active', required: false, hint: 'true/false, yes/no, active/inactive' },
] as const;

export type PeopleField = (typeof PEOPLE_FIELDS)[number]['key'];
/** Field -> CSV header it is read from. */
export type PeopleMapping = Partial<Record<PeopleField, string>>;

export const SLACK_ID_RE = /^[UW][A-Z0-9]{2,}$/;

export interface PeopleCsvInspection {
  headers: string[];
  total: number;
  sample: Array<Record<string, string>>;
  suggested: PeopleMapping;
}

export interface PeopleIssue {
  rowNo: number;
  email: string;
  level: 'error' | 'warning';
  message: string;
}

export interface PeopleImportRowPreview {
  rowNo: number;
  email: string;
  name: string;
  action: 'create' | 'update' | 'unchanged';
  manager: string | null;
}

export interface PeopleImportResult {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  managersLinked: number;
  issues: PeopleIssue[];
  /** Set when the import must not run (e.g. it would leave no compliance user). */
  blocking: string | null;
  rows: PeopleImportRowPreview[];
}

/** The editable subset of a person, as sent by the user-management form. */
export interface PersonInput {
  name?: string;
  email?: string;
  title?: string | null;
  team?: string | null;
  managerId?: number | null;
  slackUserId?: string | null;
  isManager?: boolean;
  isCompliance?: boolean;
  active?: boolean;
}

export type PersonRoleKey = 'engineer' | 'manager' | 'compliance';
export const personRoles = (p: Pick<Person, 'isManager' | 'isCompliance'>, reports: number): PersonRoleKey[] => [
  'engineer',
  ...(p.isManager || reports > 0 ? (['manager'] as const) : []),
  ...(p.isCompliance ? (['compliance'] as const) : []),
];

/** Person fields a Slack profile can feed. `manager` needs a "user" type Slack field; the rest take any text. */
export const SLACK_TARGETS = [
  { key: 'manager', label: 'Manager', hint: 'Builds the reporting hierarchy and escalation path', source: 'managerId' },
  { key: 'title', label: 'Job title', hint: 'Only filled when empty, unless overwrite is on', source: 'title' },
  { key: 'team', label: 'Team', hint: 'Only filled when empty, unless overwrite is on', source: 'department' },
  { key: 'department', label: 'Department', hint: '', source: 'department' },
  { key: 'division', label: 'Division', hint: '', source: 'division' },
  { key: 'organization', label: 'Organization', hint: '', source: 'organization' },
  { key: 'costCenter', label: 'Cost center', hint: '', source: 'costCenter' },
  { key: 'employeeNumber', label: 'Employee ID', hint: '', source: 'employeeNumber' },
  { key: 'employeeType', label: 'Employee type', hint: '', source: 'userType' },
  { key: 'location', label: 'Location', hint: '', source: 'location' },
  { key: 'timezone', label: 'Time zone', hint: '', source: 'tz' },
] as const;

export type SlackTarget = (typeof SLACK_TARGETS)[number]['key'];
/** Person field -> key of the Slack profile field it is read from. */
export type SlackMapping = Partial<Record<SlackTarget, string>>;

/** A field a Slack profile can carry. `key` is unique; `name` is Slack's stable field_name (or the synthetic name). */
export interface SlackFieldDef {
  key: string;
  name: string;
  label: string;
  type: string;
}

/** One person's Slack profile: every non-empty field value, keyed by SlackFieldDef.key. */
export interface SlackProfile {
  slackUserId: string;
  email: string;
  name: string;
  values: Record<string, string>;
}

/** The default mapping for a workspace: each target's usual source, when the workspace defines it. */
export function suggestSlackMapping(fields: SlackFieldDef[]): SlackMapping {
  const out: SlackMapping = {};
  for (const t of SLACK_TARGETS) {
    const hit = fields.find((f) => f.name === t.source);
    if (hit) out[t.key] = hit.key;
  }
  return out;
}

export interface SlackDirectoryView {
  /** Pass back to the sync so the server reuses this read instead of calling Slack again. */
  snapshotId: string;
  readAt: string;
  fields: SlackFieldDef[];
  suggested: SlackMapping;
  people: SlackProfile[];
  /** Profiles Slack would not return. They are left out. */
  failed: number;
}

export interface SlackSyncRequest {
  snapshotId: string;
  mapping: SlackMapping;
  /** Slack user ids the user ticked. */
  selected: string[];
  /** Also add each selected person's managers, up the chain, so every link resolves. */
  withChain: boolean;
  /** Replace a title or team that is already set. Off by default: those are only filled when empty. */
  overwrite: boolean;
  dryRun: boolean;
}

export interface SlackSyncRow {
  email: string;
  name: string;
  action: 'create' | 'update' | 'unchanged';
  /** True when this person was added only because someone selected reports to them. */
  viaChain: boolean;
  /** Field -> [before, after], only for fields that change. */
  changes: Record<string, [string | null, string | null]>;
  manager: string | null;
  managerChange: 'set' | 'changed' | 'kept-manual' | 'unresolved' | null;
}

export interface SlackSyncResult {
  dryRun: boolean;
  selected: number;
  chainAdded: number;
  created: number;
  updated: number;
  unchanged: number;
  managersLinked: number;
  /** Manager set in Slack but the person has a manual manager, so it was left alone. */
  managersKeptManual: number;
  withoutManager: number;
  /** Mapped fields that nobody in the selection has a value for, so nothing can be saved for them. */
  emptyTargets: SlackTarget[];
  issues: PeopleIssue[];
  rows: SlackSyncRow[];
  syncedAt: string;
}
